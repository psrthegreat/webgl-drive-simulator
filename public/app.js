angular.module('roadglApp').
controller('AppCtrl', ['$scope', '$window', 'util', 'key', 'history', 'video',
function($scope, $window, util, key, history, video) {

	var camera, scene, renderer,
		projector, raycaster,
		controls,
		geometries = {},
		pointClouds = {},
		kdtrees = {},
		groundNormals = [],
		mouse = { x: 1, y: 1 },
		windowWidth = $window.innerWidth,
		windowHeight = $window.innerHeight,
		datafiles = {
			points: "files/datafile.json",
			gps: "files/gpsfile.json",
			lanes: "files/lanesfile.json",
			planes: "files/planesfile.json"
		},
		selectedPoint,
		selectedPositions,	// index => position array
		frameCount = 0, //TODO
		DRAG_RANGE = 2,
		car,
		action = { laneNum: 0, type: "" };
	var offset = [0, 5, -14];//[0,1,-2];
	var carOffset = 0;

	$scope.init = function() {
		video.init();

		scene = new THREE.Scene();
		//scene.fog = new THREE.Fog( 0xcce0ff, 500, 10000 );
		camera = new THREE.PerspectiveCamera(75, windowWidth/windowHeight, 1, 100);
		projector = new THREE.Projector();
		raycaster = new THREE.Raycaster();
		var canvas = document.getElementById("road");
		renderer = new THREE.WebGLRenderer({canvas: canvas});
		renderer.setSize(windowWidth, windowHeight);
		//renderer.setClearColor( scene.fog.color );

		controls = new THREE.OrbitControls(camera);
		$scope.debugText = "Loading...";
		async.parallel({
			pointCloud: function(callback){
				util.loadJSON(datafiles.points, function(data) {
					pointClouds.points = $scope.generatePointCloud("points", data, 0.01);
					scene.add(pointClouds.points);
					callback(null, 1);
				});
			},
			gps: function(callback){
				util.loadJSON(datafiles.gps, function(data) {
					pointClouds.gps = $scope.generatePointCloud("gps", data, 0.01);
					callback(null, 2);
				});
			},
			lanes: function(callback){
				util.loadJSON(datafiles.lanes, function(data) {
					pointClouds.lanes = {};
					for (var lane in data){
						var laneCloud = $scope.generatePointCloud("lane"+lane, data[lane], 0.15, 255);
						scene.add(laneCloud);	
						pointClouds.lanes[lane] = laneCloud;
						var positions = laneCloud.geometry.attributes.position.array;
						kdtrees["lane"+lane] = new THREE.TypedArrayUtils.Kdtree(positions, util.distance, 3);
						history.push("original", positions, lane);
					}
					callback(null, 3);
				});
			},
			planes: function(callback){
				util.loadJSON(datafiles.planes, function(data) {
					$scope.addPlanes(data);
					callback(null, 4);
				});
			},
			car: function(callback){
				$scope.addCar(function(geometry, materials){
					callback(null, 5);
				});
			}
		},
		function(err, results) {
			$scope.debugText = "";
			$scope.execOnLoaded();
		});
	};

	$scope.addLighting = function(){
		pointLight = new THREE.PointLight( 0xffaa00 );
		scene.add( pointLight );
		pointLight.position= car.position;
		pointLight.position.x= car.position.x -5;
		directionalLight = new THREE.DirectionalLight( 0xffffff );
		directionalLight.position.set( 1, 1, 0.5 ).normalize();
		scene.add( directionalLight );		
	};

	$scope.execOnLoaded = function(){
		key.watchToggle("space");
		document.addEventListener('mousedown', $scope.onDocumentMouseDown, false);
		document.addEventListener('mousedown', $scope.rotateCamera, false);
		document.addEventListener('mouseup', $scope.onDocumentMouseUp, false);
		document.addEventListener('mousemove', $scope.onDocumentMouseMove, false);
		document.addEventListener('keydown', $scope.onDocumentKeyDown, false);
		window.addEventListener('resize', $scope.onWindowResize, false);
		$scope.addLighting();
		$scope.updateCamera(0);
		$scope.animate();
	};

	$scope.rotateCamera = function(event) {
		if (!key.isDown("ctrl")) return;
		controls.onMouseDown(event);
	};

	$scope.onDocumentMouseDown = function(event) {
		if (key.isDown("ctrl")) return;
		// event.stopPropagation();
		var intersects, lane;
		for (lane in pointClouds.lanes) {
			intersects = raycaster.intersectObject(pointClouds.lanes[lane]);
			if (intersects.length > 0) break;
		}
		if(intersects.length === 0 ) return;
		//TODO find way to check if no points are selected
		// if (lane >= pointClouds.lanes.length) return;

		var i, nearestPoints, index;
		var pointPos = intersects[0].object.geometry.attributes.position.array;
		
		if (key.isDown("shift")) {
			// select range
			var startPoint = selectedPoint,
				startPos = util.getPos(pointPos, startPoint.index);
			selectedPoint = intersects[0];
			var endPoint = selectedPoint,
				endPos = util.getPos(pointPos, endPoint.index);
			var midPoint = util.midpoint(startPos, endPos);
			var range = util.distance(startPos, endPos) / 2 + 0.01;
			nearestPoints = kdtrees["lane"+lane].nearest(midPoint, 100, range);
			selectedPositions = {};
			for (i = 0; i < nearestPoints.length; i++) {
				index = nearestPoints[i][0].pos;
				selectedPositions[index] = util.getPos(pointPos, index);
				util.paintPoint(geometries["lane"+lane].attributes.color, index, 255, 0, 0);
			}
			return;
		}
		// select point for dragging
		action = { laneNum: lane, type: "drag" };
		selectedPoint = intersects[0];
		for (index in selectedPositions) {
			util.paintPoint(geometries["lane"+lane].attributes.color, index, 255, 255, 255);
		}
		util.paintPoint(geometries["lane"+lane].attributes.color, selectedPoint.index, 255, 0, 0);
		nearestPoints = kdtrees["lane"+lane].nearest(util.getPos(pointPos, selectedPoint.index), 100, DRAG_RANGE);
		selectedPositions = {};
		for (i = 0; i < nearestPoints.length; i++) {
			index = nearestPoints[i][0].pos;
			selectedPositions[index] = new Float32Array(util.getPos(pointPos, index));
		}
		//TODO: find nearest plane instead of raycasting
		for (i = 0; i < planes.length; i++) {
			intersects = raycaster.intersectObject(planes[i]);
			if (intersects.length > 0) {
				selectedPlane = intersects[0];
				document.addEventListener('mousemove', $scope.dragPoint);
				return;
			}
		}
	};

	$scope.onDocumentMouseUp = function() {
		if (action.type !== "")
			history.push(action.type, selectedPoint.object.geometry.attributes.position.array, action.laneNum);
		action.type = "";
		document.removeEventListener('mousemove', $scope.dragPoint);
		document.removeEventListener('mouseup', $scope.clearPoint);
	};

	$scope.onDocumentMouseMove = function(event) {
		event.preventDefault();
		mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
		mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
		
		if (!key.isDown("ctrl")) return;
		offset[0] = - car.position.x + camera.position.x;
		offset[1] = - car.position.y + camera.position.y;
		offset[2] = - car.position.z + camera.position.z;
		$scope.$apply(function() {
			//$scope.debugText = JSON.stringify(offset);
		});
	};

	$scope.onDocumentKeyDown = function(event) {
		switch (event.keyCode) {
			case key.keyMap.backspace:
			case key.keyMap.del:
			case key.keyMap.D:
			case key.keyMap.d:
				event.preventDefault();
				$scope.deletePoints();
				break;
			case key.keyMap.Z:
			case key.keyMap.z:
				if (!event.ctrlKey) break;
				$scope.undo();
				break;
			case key.keyMap.Y:
			case key.keyMap.y:
				if (!event.ctrlKey) break;
				$scope.redo();
				break;
			case key.keyMap.right:
				$scope.carRight();
				break;
			case key.keyMap.left:
				$scope.carLeft();
				break;
			case key.keyMap.B:
			case key.keyMap.b:
				$scope.carBack();

		}
	};
	
	$scope.onWindowResize = function() {
		windowWidth = $window.innerWidth;
		windowHeight = $window.innerHeight;

		camera.aspect = windowWidth / windowHeight;
		camera.updateProjectionMatrix();

		renderer.setSize(windowWidth, windowHeight);
	};

	$scope.carRight= function(){
		carOffset-=0.1;
		$scope.updateCamera(frameCount);
		event.preventDefault();
	};

	$scope.carLeft = function(){
		carOffset+=0.1;
		$scope.updateCamera(frameCount);
		event.preventDefault();
	};

	$scope.carBack = function(){
		if(frameCount>=10){
			frameCount-=10;	
		}
		$scope.updateCamera(frameCount);
		event.preventDefault();
	};



	$scope.updateCamera = function(frameCount) {
		var gpsPositions = pointClouds.gps.geometry.attributes.position.array;
		car.position.x = gpsPositions[3*frameCount+0] + carOffset;
		car.position.y = gpsPositions[3*frameCount+1] -1.1;
		car.position.z = gpsPositions[3*frameCount+2];
		
		camera.position.set(car.position.x + offset[0], car.position.y + offset[1], car.position.z + offset[2]);
		
		var target = car.position;
		camera.lookAt(target);
		controls.target.copy(target);
		controls.update();
	};
	
	$scope.animate = function(timestamp) {
		// console.log(timestamp);
		requestAnimationFrame($scope.animate);
		$scope.render();
	};

	$scope.render = function() {
		camera.updateMatrixWorld(true);
		mousePosition = new THREE.Vector3(mouse.x, mouse.y, 0.5);
		projector.unprojectVector(mousePosition, camera);
		raycaster.params = {"PointCloud" : {threshold: 0.1}};
		raycaster.ray.set(camera.position, mousePosition.sub(camera.position).normalize());
		var intersects = raycaster.intersectObject(pointClouds.points);
		if(intersects.length > 0){
			// cursor.position.copy(intersects[0].point); // brush cursor
			// Paint the points with the cursor while pressing <shift>
			if (key.isDown("shift")) {
				var pointColors = geometries.points.attributes.color.array;
				for (var i = 0; i < intersects.length; i++) {
					var index = 3*intersects[i].index;
					pointColors[index] = 255;
					pointColors[index+1] = 255;
					pointColors[index+2] = 255;
				}
				geometries.points.attributes.color.needsUpdate = true;
			}
		}

		var gpsPositions = pointClouds.gps.geometry.attributes.position.array;

		if (key.isToggledOn("space")) {
			$scope.updateCamera(frameCount);
			video.nextFrame();
			frameCount++;
		}
		if (frameCount+5 >= gpsPositions.length/3) {
			frameCount = 0;
		}

		renderer.render(scene, camera);
	};

	$scope.dragPoint = function() {
		document.addEventListener('mouseup', $scope.clearPoint);
		var intersects = raycaster.intersectObject(selectedPlane.object);
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
		}
	};

	$scope.clearPoint = function() {
		util.paintPoint(selectedPoint.object.geometry.attributes.color, selectedPoint.index, 255, 255, 255);
	};

	$scope.deletePoints = function() {
		var positions = selectedPoint.object.geometry.attributes.position;
		var colors = selectedPoint.object.geometry.attributes.color;
		var boundaryIndex = Object.keys(selectedPositions)[0];
		oldPositions = new Float32Array(positions.array.length);
		lenOldPositions = 0;
		newPositions = new Float32Array(positions.array.length);
		lenNewPositions = 0;
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
		lanes = Object.keys(kdtrees).filter(function(key) {
			return key.slice(0,4) == "lane";
		}).map(function(key) {
			return parseInt(key.slice(4), 10);
		}).sort();
		var newLane;
		for (newLane = 0; newLane <= lanes.length; newLane++) {
			if (lanes[newLane] != newLane) break;
		}
		var laneCloud = $scope.generatePointCloud("lane"+newLane, newPositions.subarray(0,lenNewPositions), 0.15, 255);
		scene.add(laneCloud);	
		pointClouds.lanes[newLane] = laneCloud;
		newPositions = laneCloud.geometry.attributes.position;
		kdtrees["lane"+newLane] = new THREE.TypedArrayUtils.Kdtree(newPositions.array, util.distance, 3);
		// truncate old lane
		positions.array = new Float32Array(oldPositions.subarray(0,lenOldPositions));
		colors.array = new Float32Array(colors.array.subarray(0,lenOldPositions));
		positions.needsUpdate = true;
		colors.needsUpdate = true;
		//TODO edge case where newLane is empty
		history.push("new", newPositions.array, newLane);
		history.push("delete", positions.array, action.laneNum);
	};

	$scope.generatePointCloud = function(name, data, size, color) {
		geometries[name] = new THREE.BufferGeometry();
		var positions, colors;
		var i;
		var dataType = Object.prototype.toString.call(data);
		if (dataType === "[object Float32Array]" || dataType === "[object ArrayBuffer]") {
			positions = new Float32Array(data);
			colors = new Float32Array(positions.length);
			for (i = 0; i < colors.length; i++) colors[i] = color;
		} else {
			positions = new Float32Array(3*data.length);
			colors    = new Float32Array(3*data.length);
			for (i = 0; i < data.length; i++) {
				//Note: order is changed
				positions[3*i]   = data[i][1];	//x
				positions[3*i+1] = data[i][2];	//y
				positions[3*i+2] = data[i][0];	//z
				// map intensity (0-120) to RGB
				if (data[i].length >= 4) {
					var hue = 1 - data[i][3]/120;	//TODO: fix intensity scaling
					colors[3*i+1]   = util.HUEtoRGB(hue+1/2);	//r
					colors[3*i+2] = util.HUEtoRGB(hue);		//g
					colors[3*i+0] = util.HUEtoRGB(hue-1/2);	//b
				} else {
					colors[3*i+1] = color;
					colors[3*i+2] = color;
					colors[3*i+0] = color;
				}
			}
		}

		geometries[name].addAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometries[name].addAttribute('color', new THREE.BufferAttribute(colors, 3));
		var material = new THREE.PointCloudMaterial({ size: size, vertexColors: true });
		pointCloud = new THREE.PointCloud(geometries[name], material);

		return pointCloud;
	};

	$scope.addCar = function(callback) {
		var camaroMaterials = {
			body: {
				Orange: new THREE.MeshLambertMaterial( {
					color: 0xff6600,
					combine: THREE.MixOperation,
					reflectivity: 0.3
				} )
			},
			chrome: new THREE.MeshLambertMaterial( {
				color: 0xffffff
			} ),
			darkchrome: new THREE.MeshLambertMaterial( {
				color: 0x444444
			} ),
			glass: new THREE.MeshBasicMaterial( {
				color: 0x223344,
				opacity: 0.25,
				combine: THREE.MixOperation,
				reflectivity: 0.25,
				transparent: true
			} ),
			tire: new THREE.MeshLambertMaterial( {
				color: 0x050505
			} ),
			interior: new THREE.MeshPhongMaterial( {
				color: 0x050505,
				shininess: 20
			} ),
			black: new THREE.MeshLambertMaterial( {
				color: 0x000000
			} )
		};

		var loader = new THREE.BinaryLoader();
		loader.load("/files/CamaroNoUv_bin.js", function(geometry) { 
			var materials = camaroMaterials;
			var s = 0.27, m = new THREE.MeshFaceMaterial();
			m.materials[ 0 ] = materials.body.Orange; // car body
			m.materials[ 1 ] = materials.chrome; // wheels chrome
			m.materials[ 2 ] = materials.chrome; // grille chrome
			m.materials[ 3 ] = materials.darkchrome; // door lines
			m.materials[ 4 ] = materials.glass; // windshield
			m.materials[ 5 ] = materials.interior; // interior
			m.materials[ 6 ] = materials.tire; // tire
			m.materials[ 7 ] = materials.black; // tireling
			m.materials[ 8 ] = materials.black; // behind grille

			car = new THREE.Mesh( geometry, m );
			// car.rotation.set( - Math.PI / 2, 0, -Math.PI /2);
			car.scale.set( s, s, s );
			car.position.set( 0, -1.2, 7 );
			// TODO car gets in the way of lane editing
			scene.add( car );
			callback(); 
		});
	};

	$scope.addPlanes = function(data) {
		planes = [];
		var groundGeometry = new THREE.Geometry();
		for (var i = 0; i < data.length; i++) {
			var normal = data[i];
			var dz = normal[0],
			dx = normal[1],
			dy = normal[2],
			z = normal[3],
			x = normal[4],
			y = normal[5];
			var origin = new THREE.Vector3(x,y,z),
			direction = new THREE.Vector3(dx,dy,dz),
			end = new THREE.Vector3(x+dx,y+dy,z+dz);
			direction.normalize();
			var plane = new THREE.Plane();
			plane.setFromNormalAndCoplanarPoint(direction, origin);
			var planeGeometry = new THREE.PlaneGeometry(50, 50),
			planeMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true });
			plane = new THREE.Mesh(planeGeometry, planeMaterial);
			// groundGeometry.vertices.push()
			plane.position.set(x, y, z);
			plane.lookAt(end);
			plane.visible = false;
			scene.add(plane);
			planes.push(plane);
			// var ray = new THREE.Ray(origin, direction);
			// groundNormals.push(ray);
			var material = new THREE.LineBasicMaterial({ color: 0x00ff00 }),
			geometry = new THREE.Geometry();
			geometry.vertices.push(origin);
			geometry.vertices.push(end);
			var line = new THREE.Line(geometry, material);
			scene.add(line);
		}
	};

	$scope.undo = function() {
		history.undo(function(action, arrayBuffer, laneNum) {
			if (action == "new") {
				//TODO: likely memory leak here
				geometries["lane"+laneNum].dispose();
				scene.remove(pointClouds.lanes[laneNum]);
				delete geometries["lane"+laneNum];
				delete kdtrees["lane"+laneNum];
				delete pointClouds.lanes[laneNum];
				return;
			}
			var lanePositions = geometries["lane"+laneNum].attributes.position;
			var laneColors = geometries["lane"+laneNum].attributes.color;
			lanePositions.array = new Float32Array(arrayBuffer);
			laneColors.array = new Float32Array(lanePositions.array.length);
			for (var i = 0; i < laneColors.array.length; i++)
				laneColors.array[i] = 255;
			lanePositions.needsUpdate = true;
			laneColors.needsUpdate = true;
			if (action == "delete") {
				$scope.undo();
			}
		});
	};

	$scope.redo = function() {
		history.redo(function(laneNum, action, arrayBuffer) {
			if (action == "new") {
				var laneCloud = $scope.generatePointCloud("lane"+laneNum, arrayBuffer, 0.15, 255);
				scene.add(laneCloud);
				pointClouds.lanes[laneNum] = laneCloud;
				newPositions = laneCloud.geometry.attributes.position;
				kdtrees["lane"+laneNum] = new THREE.TypedArrayUtils.Kdtree(newPositions.array, util.distance, 3);
				$scope.redo();
				//TODO if next is delete:
				return;
			}
			var lanePositions = geometries["lane"+laneNum].attributes.position;
			var laneColors = geometries["lane"+laneNum].attributes.color;
			lanePositions.array = new Float32Array(arrayBuffer);
			laneColors.array = new Float32Array(lanePositions.array.length);
			for (var i = 0; i < laneColors.array.length; i++)
				laneColors.array[i] = 255;
			lanePositions.needsUpdate = true;
			laneColors.needsUpdate = true;
		});
	};

	$scope.init();
}]);

