angular.module('roadglApp').
factory('editor', ['util', 'key', 'history',
function(util, key, history) {
	var $scope,
		selectedPoint,
		selectedPositions = {}, // index => position array
		action = { laneNum: 0, type: "" },
		DRAG_RANGE = 19;

	function initLane(positions, laneNum) {
		history.push("original", positions, laneNum);
	}

	function init(scope) {
		$scope = scope;
		document.addEventListener('mousedown', onDocumentMouseDown, false);
		document.addEventListener('mouseup', onDocumentMouseUp, false);
		document.addEventListener('keydown', onDocumentKeyDown, false);
	}

	function onDocumentKeyDown(event) {
		var preventDefault = true;
		switch (event.keyCode) {
			case key.keyMap.esc:
				action.type = "";
				clearPoint();
				break;
			case key.keyMap.backspace:
			case key.keyMap.del:
			case key.keyMap.D:
			case key.keyMap.d:
				splitLane();
				break;
			case key.keyMap.J:
			case key.keyMap.j:
				joinLanes();
				break;
			case key.keyMap.A:
			case key.keyMap.a:
				action.type = "append";
				break;
			case key.keyMap.F:
			case key.keyMap.f:
				action.type = "fork";
				break;
			case key.keyMap.Z:
			case key.keyMap.z:
				if (!event.ctrlKey) break;
				undo();
				break;
			case key.keyMap.Y:
			case key.keyMap.y:
				if (!event.ctrlKey) break;
				redo();
				break;
			default:
				preventDefault = false;
		}
		if (preventDefault) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	function onDocumentMouseDown(event) {
		if (key.isDown("ctrl")) return;
		// event.stopPropagation();

		var intersects, lane;
		$scope.updateMouse();

		if (action.type == "fork" || action.type == "append") {
			for (i = 0; i < planes.length; i++) {
				intersects = $scope.raycaster.intersectObject(planes[i]);
				if (intersects.length > 0) break;
			}
			if (intersects.length === 0) return;
			var point = intersects[0].point;
			var newPos = new Float32Array([point.x, point.y, point.z]);
			if (action.type == "fork")
				forkLane(newPos);
			else
				appendLane(newPos);
			return;
		}

		for (lane in $scope.pointClouds.lanes) {
			intersects = $scope.raycaster.intersectObject($scope.pointClouds.lanes[lane]);
			if (intersects.length > 0) break;
		}
		if (intersects.length === 0) return;
		// if (lane >= pointClouds.lanes.length) return;

		var i, nearestPoints, index;
		var pointPos = intersects[0].object.geometry.attributes.position.array;
		
		if (key.isDown("shift")) {
			var startPoint, startPos, endPoint, endPos;
			if (action.laneNum != lane) {
				// join lane
				action.laneNum2 = lane;
				startPoint = selectedPoint;
				var startPosArray = selectedPoint.object.geometry.attributes.position.array;
				startPos = util.getPos(startPosArray, startPoint.index);
				selectedPoint = intersects[0];
				endPoint = selectedPoint;
				endPos = util.getPos(pointPos, endPoint.index);
				selectedPositions = {};
				selectedPositions[action.laneNum+"_"+startPoint.index] = startPos;
				selectedPositions[action.laneNum2+"_"+endPoint.index] = endPos;
				util.paintPoint(geometries["lane"+lane].attributes.color, endPoint.index, 255, 255, 255);
				return;
			}
			// select range
			startPoint = selectedPoint;
			startPos = util.getPos(pointPos, startPoint.index);
			selectedPoint = intersects[0];
			endPoint = selectedPoint;
			endPos = util.getPos(pointPos, endPoint.index);
			var midPoint = util.midpoint(startPos, endPos);
			var range = util.distance(startPos, endPos) / 2 + 0.01;
			nearestPoints = $scope.kdtrees["lane"+lane].nearest(midPoint, 100, range);
			selectedPositions = {};
			for (i = 0; i < nearestPoints.length; i++) {
				index = nearestPoints[i][0].pos;
				selectedPositions[index] = util.getPos(pointPos, index);
				util.paintPoint($scope.geometries["lane"+lane].attributes.color, index, 255, 255, 255);
			}
			return;
		}
		// select point for dragging
		action = { laneNum: lane, type: "" };
		selectedPoint = intersects[0];
		var color = util.generateRGB(lane);
		for (index in selectedPositions) {
			var pointKey = index.split("_");
			if (pointKey.length > 1) {
				// util.paintPoint(geometries["lane"+pointKey[0]].attributes.color, pointKey[1], 255, 255, 255);
				continue;
			}
			util.paintPoint($scope.geometries["lane"+lane].attributes.color, index, color.r, color.g, color.b);
		}
		util.paintPoint($scope.geometries["lane"+lane].attributes.color, selectedPoint.index, 255, 255, 255);
		nearestPoints = $scope.kdtrees["lane"+lane].nearest(util.getPos(pointPos, selectedPoint.index), 100, DRAG_RANGE);
		selectedPositions = {};
		for (i = 0; i < nearestPoints.length; i++) {
			index = nearestPoints[i][0].pos;
			selectedPositions[index] = new Float32Array(util.getPos(pointPos, index));
		}
		//TODO: find nearest plane instead of raycasting
		for (i = 0; i < planes.length; i++) {
			intersects = $scope.raycaster.intersectObject(planes[i]);
			if (intersects.length > 0) {
				selectedPlane = intersects[0];
				document.addEventListener('mousemove', dragPoint);
				return;
			}
		}
	}

	function onDocumentMouseUp() {
		if (action.type == "drag") {
			history.push(action.type, selectedPoint.object.geometry.attributes.position.array, action.laneNum);
			clearPoint();
			selectedPoint = null;
			selectedPositions = {};
		}
		if (action.type != "append")
			action.type = "";
		document.removeEventListener('mousemove', dragPoint);
		document.removeEventListener('mouseup', clearPoint);
	}

	function dragPoint() {
		//TODO factor
		$scope.updateMouse();
		var intersects = $scope.raycaster.intersectObject(selectedPlane.object);
		if (intersects.length > 0) {
			// var index = selectedPoint.index;
			var pointPosition = selectedPoint.object.geometry.attributes.position;
			var newPos = new THREE.Vector3();
			newPos.subVectors(intersects[0].point, selectedPlane.point);
			for (var index in selectedPositions) {
				var dist = util.distance(selectedPositions[selectedPoint.index], selectedPositions[index]);
				var weight = (Math.cos(Math.PI/DRAG_RANGE * dist) + 1)/2;
				pointPosition.array[3*index] = weight * newPos.x + selectedPositions[index][0];
				pointPosition.array[3*index+1] = weight * newPos.y + selectedPositions[index][1];
				pointPosition.array[3*index+2] = weight * newPos.z + selectedPositions[index][2];
			}
			pointPosition.needsUpdate = true;
			action.type = "drag";
		}
	}

	function colorLane(laneNum, colors) {
		var color = util.generateRGB(laneNum);
		console.log(laneNum, color);
		for (var i = 0; 3*i < colors.length; i++) {
			colors[3*i+0] = color.r;
			colors[3*i+1] = color.g;
			colors[3*i+2] = color.b;
		}
	}

	function clearPoint() {
		var color = util.generateRGB(action.laneNum);
		util.paintPoint(selectedPoint.object.geometry.attributes.color, selectedPoint.index, color.r, color.g, color.b);
	}

	function newLaneNum() {
		var lanes = Object.keys($scope.kdtrees).filter(function(key) {
			return key.slice(0,4) == "lane";
		}).map(function(key) {
			return parseInt(key.slice(4), 10);
		}).sort();
		var laneNum;
		for (laneNum = 0; laneNum <= lanes.length; laneNum++) {
			if (lanes[laneNum] != laneNum) break;
		}
		return laneNum;
	}

	function newLane(laneNum, arrayBuffer) {
		var color = util.generateRGB(laneNum);
		var laneCloud = $scope.generatePointCloud("lane"+laneNum, arrayBuffer, 0.15, color);
		$scope.scene.add(laneCloud);
		$scope.pointClouds.lanes[laneNum] = laneCloud;
		var newPositions = laneCloud.geometry.attributes.position;
		$scope.kdtrees["lane"+laneNum] = new THREE.TypedArrayUtils.Kdtree(newPositions.array, util.distance, 3);
	}

	function deleteLane(laneNum) {
		$scope.geometries["lane"+laneNum].dispose();
		$scope.scene.remove($scope.pointClouds.lanes[laneNum]);
		delete $scope.geometries["lane"+laneNum];
		delete $scope.kdtrees["lane"+laneNum];
		delete $scope.pointClouds.lanes[laneNum];
	}

	function joinLanes() {
		action.type = "join";
		var positionArrs = [],
			lanes = [],
			endPositions = [];
		for (var pointKey in selectedPositions) {
			pointKeySplit = pointKey.split("_");
			lanes.push(pointKeySplit[0]);
			endPositions.push(selectedPositions[pointKey]);
			positionArrs.push($scope.pointClouds.lanes[pointKeySplit[0]].geometry.attributes.position);
		}
		var fillPositions = util.interpolate(endPositions[0], endPositions[1]);
		// interpolate
		var lenNewPositions = positionArrs[0].array.length + fillPositions.length + positionArrs[1].array.length;
		var newPositions = new Float32Array(lenNewPositions);
		newPositions.set(positionArrs[0].array, 0);
		newPositions.set(fillPositions, positionArrs[0].array.length);
		newPositions.set(positionArrs[1].array, positionArrs[0].array.length + fillPositions.length);
		// delete second lane
		history.push("delete", positionArrs[1].array, lanes[1]);
		deleteLane(lanes[1]);
		// modify first lane
		var positions = positionArrs[0];
		var colors = $scope.pointClouds.lanes[lanes[0]].geometry.attributes.color;
		var newColors = new Float32Array(lenNewPositions);
		colorLane(lanes[0], newColors);
		delete positions.array;
		delete colors.array;
		positions.array = newPositions;
		colors.array = newColors;
		positions.needsUpdate = true;
		colors.needsUpdate = true;

		delete $scope.kdtrees["lane"+lanes[0]];
		$scope.kdtrees["lane"+lanes[0]] = new THREE.TypedArrayUtils.Kdtree(positions.array, util.distance, 3);

		history.push("join", positions.array, lanes[0]);
	}

	function splitLane() {
		action.type = "split";
		var positions = selectedPoint.object.geometry.attributes.position;
		var colors = selectedPoint.object.geometry.attributes.color;
		var boundaryIndex = Object.keys(selectedPositions)[0];
		var oldPositions = new Float32Array(positions.array.length);
		var lenOldPositions = 0;
		var newPositions = new Float32Array(positions.array.length);
		var lenNewPositions = 0;
		for (var index = 0; index < positions.length/3; index++) {
			if (index in selectedPositions) continue;
			if (positions.array[3*index+2] < positions.array[3*boundaryIndex+2]) {
				oldPositions[lenOldPositions++] = positions.array[3*index];
				oldPositions[lenOldPositions++] = positions.array[3*index+1];
				oldPositions[lenOldPositions++] = positions.array[3*index+2];
			} else {
				newPositions[lenNewPositions++] = positions.array[3*index];
				newPositions[lenNewPositions++] = positions.array[3*index+1];
				newPositions[lenNewPositions++] = positions.array[3*index+2];
			}
		}
		// Create new lane
		var laneNum = newLaneNum();
		var subNewPositions = newPositions.subarray(0,lenNewPositions);
		newLane(laneNum, subNewPositions);
		history.push("new", subNewPositions, laneNum);
		// truncate old lane
		positions.array = new Float32Array(oldPositions.subarray(0,lenOldPositions));
		colors.array = new Float32Array(colors.array.subarray(0,lenOldPositions));
		positions.needsUpdate = true;
		colors.needsUpdate = true;

		delete $scope.kdtrees["lane"+action.laneNum];
		$scope.kdtrees["lane"+action.laneNum]= new THREE.TypedArrayUtils.Kdtree(positions.array, util.distance, 3);
		//TODO edge case where newLane is empty
		history.push("split", positions.array, action.laneNum);
	}

	function appendLane(endPos) {
		var laneNum = action.laneNum;
		var positions = selectedPoint.object.geometry.attributes.position;
		var colors = selectedPoint.object.geometry.attributes.color;

		var startPos = util.getPos(positions.array, selectedPoint.index);
		var fillPositions = util.interpolate(startPos, endPos);
		var lenNewPositions = positions.array.length + fillPositions.length;
		var newPositions = new Float32Array(lenNewPositions);
		newPositions.set(positions.array, 0);
		newPositions.set(fillPositions, positions.array.length);

		var newColors = new Float32Array(lenNewPositions);
		colorLane(laneNum, newColors);

		delete positions.array;
		delete colors.array;
		positions.array = newPositions;
		colors.array = newColors;
		positions.needsUpdate = true;
		colors.needsUpdate = true;

		delete $scope.kdtrees["lane"+laneNum];
		$scope.kdtrees["lane"+laneNum]= new THREE.TypedArrayUtils.Kdtree(positions.array, util.distance, 3);

		history.push("append", positions.array, laneNum);

		// select last point for next append
		var nearestPoints = $scope.kdtrees["lane"+laneNum].nearest(endPos, 1, util.INTERPOLATE_STEP);
		if (nearestPoints.length === 0) return;
		var index = nearestPoints[0][0].pos;
		util.paintPoint($scope.geometries["lane"+laneNum].attributes.color, index, 255, 255, 255);
		selectedPoint = {
			object: $scope.pointClouds.lanes[laneNum],
			index: index
		};
	}

	function forkLane(endPos) {
		var pointPos = selectedPoint.object.geometry.attributes.position.array;
		var startPos = new Float32Array(util.getPos(pointPos, selectedPoint.index));
		var fillPositions = util.interpolate(startPos, endPos);

		var newPositions = new Float32Array(fillPositions);
		var laneNum = newLaneNum();
		newLane(laneNum, newPositions);
		history.push("fork", newPositions, laneNum);

		clearPoint();
		// select end point for next append
		var nearestPoints = $scope.kdtrees["lane"+laneNum].nearest(endPos, 1, util.INTERPOLATE_STEP);
		if (nearestPoints.length === 0) return;
		var index = nearestPoints[0][0].pos;
		util.paintPoint($scope.geometries["lane"+laneNum].attributes.color, index, 255, 255, 255);
		selectedPoint = {
			object: $scope.pointClouds.lanes[laneNum],
			index: index
		};
		action = {
			laneNum: laneNum,
			type: "append"
		};
	}

	function undo() {
		action.type = "";
		history.undo(function(action, arrayBuffer, laneNum) {
			if (action == "new" || action == "fork") {
				deleteLane(laneNum);
				return;
			} else if (action == "delete") {
				newLane(laneNum, arrayBuffer);
				return;
			}
			var lanePositions = $scope.geometries["lane"+laneNum].attributes.position;
			var laneColors = $scope.geometries["lane"+laneNum].attributes.color;
			lanePositions.array = new Float32Array(arrayBuffer);
			laneColors.array = new Float32Array(lanePositions.array.length);
			colorLane(laneNum, laneColors.array);
			lanePositions.needsUpdate = true;
			laneColors.needsUpdate = true;
			if (action == "split" || action == "join") {
				undo();
			}
		});
	}

	function redo() {
		history.redo(function(laneNum, action, arrayBuffer) {
			if (action == "new" || action == "fork") {
				newLane(laneNum, arrayBuffer);
				if (action == "new") redo();
				//TODO if next is delete:
				return;
			} else if (action == "delete") {
				deleteLane(laneNum);
				redo();
				return;
			}
			var lanePositions = $scope.geometries["lane"+laneNum].attributes.position;
			var laneColors = $scope.geometries["lane"+laneNum].attributes.color;
			lanePositions.array = new Float32Array(arrayBuffer);
			laneColors.array = new Float32Array(lanePositions.array.length);
			colorLane(laneNum, laneColors.array);
			lanePositions.needsUpdate = true;
			laneColors.needsUpdate = true;
		});
	}

	return {
		initLane: initLane,
		init: init,
		undo: undo,
		redo: redo
	};
}]);