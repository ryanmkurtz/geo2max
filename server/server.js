var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var express = require('express');
var session = require('express-session');
var strava = require('strava-v3');
var mongo = require('mongodb').MongoClient;

var db;
mongo.connect("mongodb://localhost:27017", { useNewUrlParser: true }, (err, db_new) => {
	if (err) throw err;
	db = db_new.db("strava");
	console.log("Connected to database");
});

var app = express();
app.use(session({
	secret: crypto.randomBytes(64).toString('hex'),
	name: "token",
	resave: false,
	saveUninitialized: false,
	httpOnly: true,
	signed: true
}));
app.use(express.static(path.join(__dirname, '/../client')));
app.use('/cesium', express.static(__dirname + '/../node_modules/cesium/Build/CesiumUnminified'));
app.use('/.well-known', express.static(__dirname + '/.well-known'));
app.use ((req, res, next) => {
	req.secure ? next() : res.redirect('https://' + req.headers.host + req.url);
});

var credentials = {
	key: fs.readFileSync('/etc/letsencrypt/live/geo2max.com/privkey.pem', 'utf8'),
	cert: fs.readFileSync('/etc/letsencrypt/live/geo2max.com/cert.pem', 'utf8'),
	ca: fs.readFileSync('/etc/letsencrypt/live/geo2max.com/chain.pem', 'utf8')
};

app.get('/', (req, res) => {
	console.log("/");
	delete req.session.access_token;
	res.sendFile(path.join(__dirname, '/../client/app.html'));
});

app.get('/connectToStrava', (req, res) => {
	console.log("/connectToStrava: Redirecting to Strava...");
	res.redirect(strava.oauth.getRequestAccessURL({scope:"activity:read"}));
});

app.get("/auth", (req, res) => {
	if (!req.query.error) {
		console.log("/auth: Authorization succeeded!");
		strava.oauth.getToken(req.query.code, (err, payload) => {
			if (!err && payload && payload.body && payload.body.access_token) {
				req.session.access_token = payload.body.access_token;
				req.session.athlete = payload.body.athlete;
				res.sendFile(path.join(__dirname, '/../client/app.html'));
			}
			else {
				console.error("Authorization failed!");
				res.write("Authorization failed!");
				res.end();
			}
		});
	}
	else {
		console.error("Authorization failed!");
		res.write("Authorization failed!");
		res.end();
	}
});

app.get("/checkStravaAuth", (req, res) => {
	console.log("/checkStravaAuth: " + req.session.access_token);
	res.write(JSON.stringify(req.session.access_token != undefined));
	res.end();
});

app.get("/activities", (req, res) => {
	console.log("/activities: " + getActivitiesCollectionName(req) + ", Page " + req.query.page + ", Searching '" + req.query.search + "', Sorting " + req.query.sort_by + "/" + req.query.sort_desc);
	var limit = parseInt(req.query.per_page, 10);
	var skip = parseInt((req.query.page-1) * limit, 10);
	var errorMessage = "";
	var search = req.query.search ? req.query.search.trim() : "";
	if (search && search.startsWith("{") && search.endsWith("}")) {
		try {
			search = JSON.parse(search);
		}
		catch (e) {
			search = {};
			errorMessage = e.message;
		}
	}
	else if (search) {
		search = {name: new RegExp(".*" + search.replace(/[-[\]{}()*+!<=:?.\/\\^$|#\s,]/g, '\\$&') + ".*", "i")};
	}
	else {
		search = {};
	}
	var sort = {};
	sort[req.query.sort_by] = req.query.sort_desc == "true" ? -1 : 1;
	db.collection(getActivitiesCollectionName(req))
	.find(search)
	.sort(sort)
	.toArray((err, result) => {
		if (err) {
			console.log("Collection not found");
			res.write(JSON.stringify({total: 0, activities: [], error: errorMessage}));
		}
		else {
			res.write(JSON.stringify({
				total: result.length,
				activities: result.slice(skip, skip + limit),
				error: errorMessage
			}));
		}
		res.end();
	});
});

app.get("/latLngStream", (req, res) => {
	console.log("/latLngStream: ID " + req.query.id);
	strava.streams.activity({
		'access_token': req.session.access_token, 
		'id': req.query.id, 
		'types': 'latlng'
	}, (err, payload, limits) => {
		if (payload) {
			res.write(JSON.stringify(payload));
			res.end();
		}
	});
});

app.get("/sync", (req, res) => {
	console.log("/sync: " + getActivitiesCollectionName(req));
	function processPage(page, allActivities, mostRecentActivity=null) {
		console.log("Fetching page " + page);
		strava.athlete.listActivities({
			'access_token': req.session.access_token,
			'page': page,
			'per_page': 200
		}, (err, payload, limits) => {
			if (err) {
				console.log(err.error);
				res.write(JSON.stringify({error: err.error.message}));
				res.end();
				return;
			}
			var activities = payload;
			var done = false;
			if (activities && activities.length > 0) {
				for (var i = 0; i < activities.length; i++) {
					if (mostRecentActivity && Date.parse(mostRecentActivity.start_date) >= Date.parse(activities[i].start_date)) {
						done = true;
						break;
					}
					allActivities.push(activities[i]);
				}
			}
			else {
				done = true;
			}
			if (done) {
				db.collection(getActivitiesCollectionName(req))
				.countDocuments({}, (err, count) => {
					var total = !err ? count : 0;
					db.collection(getActivitiesCollectionName(req))
					.insertMany(allActivities, (err, result) => {
						if (err) {
							console.log("Failed to insert activities");
						}
						else {
							console.log("Successfully inserted " + allActivities.length + " new activities");
						}
						res.write(JSON.stringify({total: total + allActivities.length, num_inserted: allActivities.length}));
						res.end();
					});
				});
			}
			else {
				processPage(++page, allActivities);
			}
		});
	}
	db.collection(getActivitiesCollectionName(req))
	.find({})
	.sort({start_date: -1})
	.limit(1)
	.toArray((err, result) => {
		var mostRecentActivity = !err && result.length > 0 ? result[0] : null;
		if (mostRecentActivity) {
			console.log("Most recent activity: " + mostRecentActivity.start_date);
		}
		processPage(1, new Array(), mostRecentActivity);
	});
});

app.get("/drop", (req, res) => {
	console.log("/drop: " + getActivitiesCollectionName(req));
	db.collection(getActivitiesCollectionName(req))
	.drop((err, delOK) => {
		if (err) {
			console.log("Collection not found");
		}
		if (delOK) {
			console.log("Successfully dropped");
		}
		res.end();
	});
});

function getActivitiesCollectionName(req) {
	return "activities_" + req.session.athlete.id;
}

http.createServer(app).listen(80, () => {
	console.log('HTTP server running on port 80');
});

https.createServer(credentials, app).listen(443, () => {
	console.log('HTTPS server running on port 443');
});
