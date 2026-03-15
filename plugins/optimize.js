Plugin.register("optimize", {
title: "Optimize",
author: "Krozi & Exsistory",
icon: "border_outer",
version: "1.3.0",
description: "Hide concealed faces for better performance, with multi-axis support!",
onload() {
	
MenuBar.addAction(new Action({
	id: "optimize",
	name: "Optimize",
	icon: "border_outer",
	category: "filter",
	click: function(ev) {
try {
	var dialog = new Dialog({title:'Optimize', id:'optimize_options', lines:[
		'<p>Restrict to selected elements <input type="checkbox" id="restrict"></p>',
		'<p>Apply culling (Blockmodels only)<input type="checkbox" id="culling"></p>',
		'<br/>Please check if all visible cubes are still there.<br/>Unwanted changes can be reverted using Ctrl+Z.'
	],
	"onConfirm": function(data) {
	var restrictToSelected = $("#restrict")[0].checked;
	var applyCulling = $("#culling")[0].checked;
	dialog.hide();
	
	var elements = Outliner.elements;
	if (restrictToSelected) {
		elements = selected;
	}
	var aspects = {"elements": elements, "uv_only": false};
	Undo.initEdit(aspects);
	
	Blockbench.showMessage('Starting optimization', 'center');
	var axisToFace = ['west', 'down', 'north', 'east', 'up', 'south'];
	var epsilon = 0.001;
	var removedFaces = 0;
	var culledFaces = 0;
	var invisibleCubes = [];

	function getWorldFacePolygons(cube) {
		var polygons = {};
		var inf = cube.inflate || 0;
		var baseVertices = {
			north: [ [cube.from[0]-inf, cube.from[1]-inf, cube.from[2]-inf], [cube.to[0]+inf, cube.from[1]-inf, cube.from[2]-inf], [cube.to[0]+inf, cube.to[1]+inf, cube.from[2]-inf], [cube.from[0]-inf, cube.to[1]+inf, cube.from[2]-inf] ],
			south: [ [cube.from[0]-inf, cube.from[1]-inf, cube.to[2]+inf], [cube.to[0]+inf, cube.from[1]-inf, cube.to[2]+inf], [cube.to[0]+inf, cube.to[1]+inf, cube.to[2]+inf], [cube.from[0]-inf, cube.to[1]+inf, cube.to[2]+inf] ],
			west:  [ [cube.from[0]-inf, cube.from[1]-inf, cube.from[2]-inf], [cube.from[0]-inf, cube.from[1]-inf, cube.to[2]+inf], [cube.from[0]-inf, cube.to[1]+inf, cube.to[2]+inf], [cube.from[0]-inf, cube.to[1]+inf, cube.from[2]-inf] ],
			east:  [ [cube.to[0]+inf, cube.from[1]-inf, cube.from[2]-inf], [cube.to[0]+inf, cube.from[1]-inf, cube.to[2]+inf], [cube.to[0]+inf, cube.to[1]+inf, cube.to[2]+inf], [cube.to[0]+inf, cube.to[1]+inf, cube.from[2]-inf] ],
			down:  [ [cube.from[0]-inf, cube.from[1]-inf, cube.from[2]-inf], [cube.to[0]+inf, cube.from[1]-inf, cube.from[2]-inf], [cube.to[0]+inf, cube.from[1]-inf, cube.to[2]+inf], [cube.from[0]-inf, cube.from[1]-inf, cube.to[2]+inf] ],
			up:    [ [cube.from[0]-inf, cube.to[1]+inf, cube.from[2]-inf], [cube.to[0]+inf, cube.to[1]+inf, cube.from[2]-inf], [cube.to[0]+inf, cube.to[1]+inf, cube.to[2]+inf], [cube.from[0]-inf, cube.to[1]+inf, cube.to[2]+inf] ]
		};

		var matrix = new THREE.Matrix4();
		var position = new THREE.Vector3(cube.origin[0], cube.origin[1], cube.origin[2]);
		var euler = new THREE.Euler(
			Math.PI * cube.rotation[0] / 180,
			Math.PI * cube.rotation[1] / 180,
			Math.PI * cube.rotation[2] / 180,
			'ZYX'
		);
		var quaternion = new THREE.Quaternion().setFromEuler(euler);
		var scale = new THREE.Vector3(1, 1, 1);
		
		matrix.compose(position, quaternion, scale);
		var invOrigin = new THREE.Matrix4().makeTranslation(-cube.origin[0], -cube.origin[1], -cube.origin[2]);
		matrix.multiply(invOrigin);

		for (var dir in baseVertices) {
			if (cube.faces[dir].texture === null) continue;
			var transformed = baseVertices[dir].map(function(v) {
				var vec = new THREE.Vector3(v[0], v[1], v[2]);
				vec.applyMatrix4(matrix);
				return vec;
			});
			polygons[dir] = transformed;
		}
		return polygons;
	}

	function isPolygonOccluded(poly1, poly2) {
		var center1 = new THREE.Vector3().addVectors(poly1[0], poly1[2]).multiplyScalar(0.5);
		var center2 = new THREE.Vector3().addVectors(poly2[0], poly2[2]).multiplyScalar(0.5);
		
		if (center1.distanceTo(center2) > epsilon) return false;

		var normal1 = new THREE.Vector3().subVectors(poly1[1], poly1[0]).cross(new THREE.Vector3().subVectors(poly1[2], poly1[0])).normalize();
		var normal2 = new THREE.Vector3().subVectors(poly2[1], poly2[0]).cross(new THREE.Vector3().subVectors(poly2[2], poly2[0])).normalize();

		if (Math.abs(normal1.dot(normal2) + 1) > epsilon) return false;

		var area1 = poly1[0].distanceTo(poly1[1]) * poly1[1].distanceTo(poly1[2]);
		var area2 = poly2[0].distanceTo(poly2[1]) * poly2[1].distanceTo(poly2[2]);
		
		if (area1 > area2 + epsilon) return false;

		return true;
	}

	var cubePolygons = new Map();
	Outliner.elements.forEach(function(cube) {
		if (cube.type === 'cube') {
			cubePolygons.set(cube, getWorldFacePolygons(cube));
		}
	});

	for (var i=0; i<elements.length; i++) {
		var cube1 = elements[i];
		if (cube1.type !== 'cube') continue;

		var polys1 = cubePolygons.get(cube1);
		
		for (var faceAxis = 0; faceAxis < 6; faceAxis++) {
			var dir1 = axisToFace[faceAxis];
			if (cube1.faces[dir1].texture === null) continue;

			if (applyCulling) {
				delete cube1.faces[dir1].cullface;
			}

			var occluded = false;
			if (polys1[dir1]) {
				for (var j = 0; j < Outliner.elements.length; j++) {
					var cube2 = Outliner.elements[j];
					if (cube1 === cube2 || cube2.type !== 'cube') continue;
					var polys2 = cubePolygons.get(cube2);
					
					for (var dir2 in polys2) {
						if (isPolygonOccluded(polys1[dir1], polys2[dir2])) {
							occluded = true;
							break;
						}
					}
					if (occluded) break;
				}
			}

			if (occluded) {
				cube1.faces[dir1].texture = null;
				removedFaces++;
			} else if (applyCulling && polys1[dir1]) {
				var p = polys1[dir1];
				var limits = [
					{ axis: 'x', val: 0, face: 'west' },
					{ axis: 'y', val: 0, face: 'down' },
					{ axis: 'z', val: 0, face: 'north' },
					{ axis: 'x', val: 16, face: 'east' },
					{ axis: 'y', val: 16, face: 'up' },
					{ axis: 'z', val: 16, face: 'south' }
				];

				for (var l = 0; l < limits.length; l++) {
					var limit = limits[l];
					var touches = true;
					for (var v = 0; v < 4; v++) {
						var val = limit.axis === 'x' ? p[v].x : (limit.axis === 'y' ? p[v].y : p[v].z);
						if (Math.abs(val - limit.val) > epsilon) {
							touches = false;
							break;
						}
					}
					if (touches) {
						cube1.faces[dir1].cullface = limit.face;
						culledFaces++;
						break;
					}
				}
			}
		}

		var visible = false;
		for (var invisibleFace=0; invisibleFace<6; invisibleFace++) {
			if (cube1.faces[axisToFace[invisibleFace]].texture !== null) {
				visible = true;
				break;
			}
		}
		if (!visible) {
			invisibleCubes.push(i);
		}
	}

	for (var idx = invisibleCubes.length-1; idx >= 0; idx--) {
		elements[invisibleCubes[idx]].remove();
	}
	
	updateSelection();
	var msg = 'Faces removed: ' + removedFaces;
	if (invisibleCubes.length > 0) msg += ', Cubes removed: ' + invisibleCubes.length;
	if (culledFaces > 0) msg += ', Faces culled: ' + culledFaces;
	
	Blockbench.showMessage(msg, 'center');
	Undo.finishEdit("optimize", aspects);
	Canvas.updateAllFaces();
	}})
	dialog.show()
}
catch(err) {
	Blockbench.showMessage(err.message + err, 'center')
	console.error(err)
}

}}), "filter")

},

onunload() {
	MenuBar.removeAction("filter.optimize")
}
})
