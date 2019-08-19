/* global Vue */
/* global Cesium */
/* global fetch */

var app = new Vue({
	el: '#app',
	data: {
		connectedToStrava: true,
		itemsLoading: 0,
		activities: [],
		activityFields: [],
		activityRows: [],
		activityPage: 1,
		activitiesPerPage: 50,
		activitiesTotal: 0,
		activitiesShown: 0,
		showAppalachianTrail: false,
		searchTextCurrent: "",
		searchTextActive: "",
		sortBy: "start_date",
		sortDesc: true,
		sortDirection: "desc",
		ftp: "",
		weight: "",
		units: ["imperial", "metric"],
		selectedUnits: "imperial"
	},
	visibleDataSources: {},
	visibleEntities: {},

	mounted: function() {

		this.itemsLoading++;

		// Initialize Cesium
		Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxNzM0YTdlNy02YzRmLTQ3ODktYjM1MS1kNDQ2YzRlOTI0NmQiLCJpZCI6NjEyNiwic2NvcGVzIjpbImFzciIsImdjIl0sImlhdCI6MTU0NTMwMDQyMX0.Y6M07a2JUPDxb2iScufTgy2Q7dtK_-Qn1gP1omCm9fA";
		this.cesium = new Cesium.Viewer("cesiumContainer", {
			geocoder: true,
			homeButton: true,
			sceneModePicker: false,
			baseLayerPicker: true,
			navigationHelpButton: false,
			animation: false,
			creditsDisplay: false,
			timeline: false,
			fullscreenButton: true
		});
		this.cesium.terrainProvider = Cesium.createWorldTerrain({
			requestWaterMask: true,
			requestVertexNormals: true 
		});
		var baseLayerPickerViewModel = this.cesium.baseLayerPicker.viewModel;
		baseLayerPickerViewModel.selectedImagery = baseLayerPickerViewModel.imageryProviderViewModels[1];
		var iframe = document.getElementsByClassName('cesium-infoBox-iframe')[0];
		iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms'); 

		// Check to see if we are connected to Strava.
		// If so, sync activities.
		fetch("checkStravaAuth", {credentials: "same-origin"})
		.then((response) => response.json())
		.then((data) => {
			this.connectedToStrava = data;
			if (this.connectedToStrava) {
				this.sync();
			}
			this.itemsLoading--;
		});
	},
	watch: {

		// Toggles drawing the Appalachian Trail
		showAppalachianTrail: function () {
			app.itemsLoading++;
			if (app.showAppalachianTrail) {
				Cesium.KmlDataSource.load("data/at_centerline.kmz", {
					camera: app.cesium.scene.camera,
					canvas: app.cesium.scene.canvas
				}).then(function(dataSource) {
					for (var entity of dataSource.entities.values) {
						if (Cesium.defined(entity.polyline)) {
							entity.polyline.clampToGround = true;
							entity.polyline.width = 2,
							entity.polyline.material = Cesium.Color.WHITE;
						}
					}
					app.cesium.dataSources.add(dataSource).then(function(dataSource) {
						app.$options.visibleDataSources["appalachianTrail"] = dataSource;
						app.itemsLoading--;
					});
				});
			}
			else {
				app.cesium.dataSources.remove(app.$options.visibleDataSources.appalachianTrail, true);
				delete app.$options.visibleDataSources.appalachianTrail;
				app.itemsLoading--;
			}
		}
	},
	computed: {

		// Computes watts/kg
		wattsPerKg: function() {
			if (isNaN(parseFloat(this.ftp)) || isNaN(parseFloat(this.weight))) {
				return "N/A";
			}
			else {
				return (this.ftp / (this.weight / 2.2046226218)).toFixed(2);
			}
		}

	},
	methods: {

		// Attempt to connect to Strava
		connectToStrava: function() {
			window.location.replace("connectToStrava");
		},

		// Synchronizes activity database, showing new activities
		sync: function() {
			this.itemsLoading++;
			fetch("sync", {credentials: "same-origin"})
			.then((response) => response.json())
			.then((data) => {
				var message;
				if (data.num_inserted > 0) {
					message = "Added " + data.num_inserted + " new ";
					if (data.num_inserted == 1) {
						message += "activity."
					}
					else {
						message += "activities.";
					}
				}
				else {
					message = "No new activities.";
				}
				app.activitiesTotal = data.total;
				app.activitiesShown = data.total;
				app.notify("Synchronize Activities", message, "success");
				app.activityPage = 1;
				app.searchTextCurrent = "";
				app.searchTextActive = "";
				app.getActivities();
				app.itemsLoading--;
			});
		},

		// Drops activity database, clearing all activities
		drop: function() {
			this.itemsLoading++;
			fetch("drop", {credentials: "same-origin"})
			.then((response) => {
				app.activitiesTotal = 0;
				app.activitiesShown = 0;
				app.activityPage = 1;
				app.searchTextCurrent = "";
				app.searchTextActive = "";
				app.getActivities();
				app.itemsLoading--;
			});
		},

		// Gets a page of user activities
		getActivities: function() {

			if (!app.connectedToStrava) {
				return;
			}

			this.itemsLoading++;

			var page = "page=" + this.activityPage;
			var perPage = "per_page=" + this.activitiesPerPage;
			var search = "search=" + encodeURIComponent(this.searchTextActive);
			var sortBy = "sort_by=" + this.sortBy;
			var sortDesc = "sort_desc=" + this.sortDesc;
			fetch("activities?" + page + "&" + perPage + "&" + search + "&" + sortBy + "&" + sortDesc, {credentials: "same-origin"})
			.then((response) => response.json())
			.then((data) => {
				if (data.error) {
					app.notify("Get Activities", data.error, "danger");
				}
				app.activities = data.activities;
				app.activitiesShown = data.total;
				app.activityFields = [
					{key: "selected", label: "Geo", "class": "text-center"},
					{key: "name", label: "Name", sortable: true},
					{key: "type", label: "Type", sortable: true},
					{key: "start_date", label: "Date", sortable: true},
					{key: "distance", label: "Distance", sortable: true},
					{key: "total_elevation_gain", label: "Elevation", sortable: true},
					{key: "moving_time", label: "Time (moving)", sortable: true},
					{key: "pr_count", label: "PR's", sortable: true},
					{key: "kudos_count", label: "Kudos", sortable: true},
					{key: "comment_count", label: "Comments", sortable: true},
					{key: "total_photo_count", label: "Photos", sortable: true}
				];
				app.activityRows = [];
				for (var activity of app.activities) {
					var date = new Date(activity.start_date_local);
					var movingTime = new Date(null);
					movingTime.setSeconds(activity.moving_time);

					app.activityRows.push({
						"selected": app.$options.visibleEntities.hasOwnProperty(activity.id),
						"name": activity.name,
						"type": activity.type,
						"start_date": (date.getMonth() + 1) + "/" + date.getDate() + "/" + date.getFullYear(),
						"distance": activity.distance,
						"total_elevation_gain": activity.total_elevation_gain,
						"moving_time": movingTime.toISOString().substr(11, 8),
						"pr_count": activity.pr_count,
						"kudos_count": activity.kudos_count,
						"comment_count": activity.comment_count,
						"total_photo_count": activity.total_photo_count,
						"id": activity.id,
						"has_geo": activity.start_latitude != null
					});
				}
				app.itemsLoading--;
			});
		},

		// Called when user clicks the clear button
		clear: function() {

			// Uncheck everything on current page
			for (var i = 0; i < app.activityRows.length; i++) {
				app.activityRows[i].selected = false;
			}

			// Toggle appalachian trail off
			app.showAppalachianTrail = false;

			// Clear everything else
			app.cesium.entities.removeAll(true);
			app.cesium.dataSources.removeAll(true);
			app.$options.visibleEntities = {};
			app.$options.visibleDataSources = {};

			// Clear search
			app.clearSearch();
		},

		// Called when user clicks the previous page button
		previousActivityPage: function() {
			if (app.activityPage > 1) {
				app.activityPage--;
				app.getActivities();
			}
		},

		// Called when user clicks the next page button
		nextActivityPage: function() {
			if (app.activities.length > 0) {
				app.activityPage++;
				app.getActivities();
			}
		},

		// Draws the given activity, and optionally flies to it
		drawActivity: function(activity, flyToActivity = false) {
			app.itemsLoading++;

			// Draw the route with starting and ending points
			fetch("latLngStream?id=" + activity.id, {credentials: "same-origin"})
			.then((response) => response.json())
			.then((data) => {

				// Convert latitude/longitude array into 3D Cartesian points
				var points;
				// data can be {message: "error"} sometimes...handle it
				for (var element of data) {
					if (element.type == "latlng" && element.data.length > 0) {
						var coords = new Array(element.data.length * 2);
						for (var i = 0; i < element.data.length; i++) {
							coords[2*i] = element.data[i][1];
							coords[2*i + 1] = element.data[i][0];
						}
						points = Cesium.Cartesian3.fromDegreesArray(coords);
						break;
					}
				}

				if (points) {

					var entities = [];

					// Create the route line
					entities.push({
						polyline : {
							positions: points,
							width: 4,
							material: Cesium.Color.RED,
							clampToGround: true
						}
					});

					// Create the start point with activity name label
					var pinBuilder = new Cesium.PinBuilder();
					entities.push({
						position: points[0],
						name: activity.name,
						description:'<p>Distance: ' + (activity.distance * 0.6214 / 1000).toFixed(2) + ' miles</p>' +
							'<p><a target="_blank" style="color: #fc4c02;" href="https://www.strava.com/activities/' +  activity.id + '">View on Strava</a></p>',
						billboard: {
							image: pinBuilder.fromColor(Cesium.Color.GREEN, 48).toDataURL(),
							verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
							heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
						},
						label : {
							text: activity.name,
							font: '12pt monospace',
							fillColor: Cesium.Color.YELLOW,
							style: Cesium.LabelStyle.FILL_AND_OUTLINE,
							outlineWidth: 2,
							verticalOrigin: Cesium.VerticalOrigin.TOP,
							pixelOffset: new Cesium.Cartesian2(0, 16),
							heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
							disableDepthTestDistance: 0
						}
					});

					// Create the end point
					entities.push({
						position : points[points.length - 1],
						name: 'Finish',
						point : {
							pixelSize: 7,
							color: Cesium.Color.RED,
							outlineWidth: 1,
							heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
						}
					});

					// Draw the entities and save them so they can be removed later
					app.$options.visibleEntities[activity.id] = [];
					for (var i = 0; i < entities.length; i++) {
						app.$options.visibleEntities[activity.id].push(app.cesium.entities.add(entities[i]));
					}

					// Fly to the activity
					if (points && flyToActivity) {
						var rectangle = Cesium.Rectangle.fromCartesianArray(points);
						var cameraPoint = app.cesium.camera.getRectangleCameraCoordinates(rectangle);
						var cameraCartographic = Cesium.Cartographic.fromCartesian(cameraPoint);
						var promise = Cesium.sampleTerrainMostDetailed(
							app.cesium.terrainProvider, 
							[Cesium.Cartographic.clone(cameraCartographic)]
						);
						Cesium.when(promise, function(updatedPositions) {
							cameraCartographic.height += updatedPositions[0].height + 500;
							app.cesium.camera.flyTo({ 
								destination: Cesium.Cartographic.toCartesian(cameraCartographic)
							});
						});
					}
				}
				else if (flyToActivity) {
					app.cesium.camera.flyHome();
				}
				app.itemsLoading--;
			});
		},

		// Called when user toggles an activity checkbox in the activities table
		toggleActivity: function(record, index) {

			var selected = !record.selected;
			var activity = app.activities[index];

			if (!selected) {
				// Remove activity from globe
				for (var i = 0; i <  app.$options.visibleEntities[activity.id].length; i++) {
					app.cesium.entities.remove(app.$options.visibleEntities[activity.id][i], true);
				}
				delete app.$options.visibleEntities[activity.id];
			}
			else {
				app.drawActivity(activity, true);
			}
		},

		// Displays a notification dialog
		notify: function(title, message, variant) {
			this.$bvToast.toast(message, {
				title: title,
				autoHideDelay: 3000,
				variant: variant,
				solid: true,
				toaster: "b-toaster-top-center",
				appendToast: false
			});
		},

		// Search activities
		search: function() {
			app.searchTextActive = app.searchTextCurrent;
			app.activityPage = 1
			app.getActivities();
		},

		// Clear search, showing all activities
		clearSearch: function() {
			app.searchTextActive = "";
			app.searchTextCurrent = "";
			app.activityPage = 1
			app.getActivities();
		},

		// Called when the activity table sort has changed
		sortingChanged: function(context) {
			app.sortBy = context.sortBy;
			app.sortDesc = context.sortDesc;
			app.getActivities();
		},

		// Converts the given distance in meters to the proper units
		convertDistance: function(distance) {
			if (app.selectedUnits == "imperial") {
				distance *= 0.00062137;
			}
			else {
				distance /= 1000;
			}
			return distance.toFixed(2);
		},

		// Converts the given elevation in meters to the proper units
		convertElevation: function(elevation) {
			if (app.selectedUnits == "imperial") {
				elevation *= 3.28084
			}
			return elevation.toFixed(2)
		}
	}
});
