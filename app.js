const express = require("express");
const dotenv = require("dotenv");
const pg = require("pg");
const bodyParser = require("body-parser");
const session = require("express-session");
const axios = require("axios");

/* Reading global variables from config file */
dotenv.config();
const PORT = process.env.PORT;
const conString = process.env.DB_CON_STRING;

if (conString == undefined) {
  console.log("ERROR: environment variable DB_CON_STRING not set.");
  process.exit(1);
}

const dbConfig = {
  connectionString: conString,
  ssl: { rejectUnauthorized: false }
}

var dbClient = new pg.Client(dbConfig);
dbClient.connect();

var urlencodedParser = bodyParser.urlencoded({
  extended: false
});

/*
 *
 * Express setup
 *
*/

app = express();
app.use(session({
  secret: "no",
  cookie: { maxAge: 3600000 },
  reasve: true,
  saveUninitialized: true
}));

//turn on serving static files (required for delivering css to client)
app.use(express.static("public"));
//configure template engine
app.set("views", "views");
app.set("view engine", "pug");

app.get('/', (req, res) => {
  req.session.destroy(function (err) {
    console.log("Session destroyed.")
  });
  res.render("index");
});

app.get('/signup', (req, res) => {
  res.render("signup");
});

app.post('/signup', urlencodedParser, function (req, res) {
  var email = req.body.email.toLowerCase();
  var vorname = req.body.vorname;
  var nachname = req.body.nachname;

  dbClient.query("SELECT * FROM users WHERE email = $1", [email], function (dbError, dbResponse) {
    if (dbResponse.rows.length !== 0) {
      res.render("signup", { login_error: "Die E-Mail Adresse wurde bereits eingegeben!" })
    }
    else {
      dbClient.query("INSERT INTO users(email, firstname, surname, password) VALUES ($1, $2, $3, $4)", [email, vorname, nachname, req.body.passwort], function (dbError, dbResponse) {
        res.render("index");
      })
    }
  })
})

app.post('/', urlencodedParser, function (req, res) {
  var email = req.body.email.toLowerCase();

  if (email !== "" || req.body.passwort !== "") {
    dbClient.query("SELECT * FROM users WHERE email = $1 AND password = $2", [email, req.body.passwort], function (dbError, dbResponse) {
      if (dbResponse.rows.length === 1) {
        req.session.user = email;
        res.redirect("dashboard");
      }
      else {
        res.render("index", { login_error: "Falsche Emailadresse oder Passwort!" })
      }
    })
  }
  else {
    res.redirect("signup")
  }

})

app.get('/dashboard', function (req, res) {
  var wetterobject = [];
  var windobject = [];
  var trendobject =[];
  if (isloggedin(req.session.user, res)) {
    dbClient.query("SELECT cityname, abocities.id AS id, latitude, longitude, wetter, luftdruck, wind, temperatur, windrichtung FROM (SELECT * FROM cities WHERE cities.email = $1) AS abocities LEFT JOIN (SELECT readings.* FROM readings JOIN (SELECT cityid, MAX(id) AS MaxID FROM readings GROUP BY cityid) groupdates ON readings.id = groupdates.MaxID AND readings.cityid = groupdates.cityid AND readings.email = $1) AS singlecity ON abocities.id = singlecity.cityid", [req.session.user], function (dbError, dbResponse) {
      if (dbResponse.rows.length !== 0) {
        dbClient.query("SELECT cityid, MAX(temperatur) AS maxt, MIN(temperatur) AS mint, MAX(wind) AS maxw, MIN(wind) AS minw, MAX(luftdruck) AS maxl, MIN(luftdruck) AS minl FROM (SELECT cities.id AS cityid, COALESCE(temperatur,0) AS temperatur,COALESCE(wind,0) AS wind, COALESCE(luftdruck,0) AS luftdruck, cities.email AS email FROM readings RIGHT JOIN cities ON readings.cityid = cities.id) AS subquery WHERE email = $1 GROUP BY cityid", [req.session.user], async function (dbError, dbWerteResponse) {
          if (dbWerteResponse.rows.length !== 0) {
            for (var i = 0; i < dbResponse.rows.length; i++) {
              wetterobject.push(wetterparse(dbResponse.rows[i].wetter));
              windobject.push(windparse(dbResponse.rows[i].windrichtung));
              trendobject.push( await trends(req.session.user, dbResponse.rows[i].id));
            }
            res.render("dashboard", {
              cities_length: dbResponse.rows.length,
              cities: dbResponse.rows,
              werte: dbWerteResponse.rows,
              wettericon: wetterobject,
              windrichtung: windobject,
              trends: trendobject
            })
          }
        });
      }
      else {
        res.render("dashboard", {
          cities_length: dbResponse.rows.length,
          cities: 0,
          werte: 0,
          wettericon: {
            icon: "app",
            text: ""
          },
          windrichtung: {
            Richtung: ""
          },
          trends:{
            trend: {
              temperatur: {
                icon: "app"
              },
              wind: {
                icon: "app"
              },
              luftdruck: {
                icon: "app"
              }
            }
          }
        })
      }
    });
  }
});

app.get('/stations/:cityid', function (req, res) {
  var cityId = req.params.cityid;

  if (isloggedin(req.session.user, res)) {
    dbClient.query("SELECT * FROM cities JOIN readings ON readings.cityid = cities.id AND readings.cityid = $1 AND readings.email = $2 ORDER BY readings.id DESC", [cityId, req.session.user], function (dbError, dbResponse) {
      if (dbResponse.rows.length !== 0) {
        dbClient.query("SELECT MAX(temperatur) AS maxt, MIN(temperatur) AS mint, MAX(wind) AS maxw, MIN(wind) AS minw, MAX(luftdruck) AS maxl, MIN(luftdruck) AS minl FROM (SELECT COALESCE(temperatur,0) AS temperatur, COALESCE(wind,0) AS wind, COALESCE(luftdruck,0) AS luftdruck FROM readings WHERE email = $1 AND cityid=$2) AS subquery", [req.session.user, cityId], async function (dbError, dbWerteResponse) {
          if (dbWerteResponse.rows.length !== 0) {
            res.render("stations", {
              dates: dbResponse.rows,
              review: dbResponse.rows[0],
              werte: dbWerteResponse.rows[0],
              wettericon: wetterparse(dbResponse.rows[0].wetter),
              windrichtung: windparse(dbResponse.rows[0].windrichtung),
              trends: await trends(req.session.user, cityId)
            })
          }
        });
      }
      else {
        dbClient.query("SELECT id AS cityid, cityname, latitude, longitude FROM cities WHERE cities.id = $1", [cityId], function (dbError, dbEmptyResponse) {
          res.render("stations", {
            review: dbEmptyResponse.rows[0],
            dates: 0,
            werte: 0,
            wettericon: {
              icon: "app",
              text: ""
            },
            windrichtung: {
              Richtung: ""
            },
            trends:{
              trend: {
                temperatur: {
                  icon: "app"
                },
                wind: {
                  icon: "app"
                },
                luftdruck: {
                  icon: "app"
                }
              }
            }
          })
        })
      }
    });
  }
});

app.post('/dashboard', urlencodedParser, function (req, res) {
  var name = req.body.namestation;
  var latitude = req.body.latitude;
  var longitude = req.body.longitude;
  var cityId = req.body.cityid;

  if (cityId !== undefined) {
    dbClient.query("DELETE FROM readings WHERE cityid = $1", [cityId], function (dbError, dbResponse) { 
    })
    dbClient.query("DELETE FROM cities WHERE id = $1", [cityId], function (dbError, dbResponse) {
    })
    res.redirect("/dashboard")
  }
  else if (name !== undefined || latitude !== undefined || longitude !== undefined) {
    dbClient.query("INSERT INTO cities (cityname, latitude, longitude, email) VALUES ($1, $2, $3, $4)", [name, latitude, longitude, req.session.user], function (dbError, dbResponse) {
      res.redirect("/dashboard");
    }
    )
  }
  else{
    res.redirect("/dashboard");
  }
})

app.post('/stations/:cityid', urlencodedParser, function (req, res) {
  var cityId = req.params.cityid;
  var wetter = req.body.code;
  var temperatur = req.body.temperatur;
  var wind = req.body.windgeschwindigkeit;
  var windrichtung = req.body.windrichtung;
  var luftdruck = req.body.luftdruck;
  var zeitpunkt = new Date();
  var date = zeitpunkt.toString();
  var latitude = req.body.latitude;
  var longitude = req.body.longitude;
  var dateid = req.body.dateid;
  var checkautomatic = req.body.checkautomatic;

  if(checkautomatic === "true"){
    automaticadd(cityId, latitude, longitude, req.session.user, res);
    
  }
  else if(dateid !== undefined) {
    dbClient.query("DELETE FROM readings WHERE id = $1", [dateid], function (dbError, dbResponse) {
      res.redirect("/stations/" + cityId)
    })
  }
  else if(wetter !== "" || temperatur !== "" || wind !== "" || windrichtung !== "" || luftdruck !== "") {
    dbClient.query("INSERT INTO readings (cityid, wetter, temperatur, wind, luftdruck, zeitpunkt, windrichtung, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [cityId, wetter, temperatur, wind, luftdruck, date, windrichtung, req.session.user], function (dbError, dbResponse) {
      res.redirect("/stations/" + cityId)
    })
  }
  else{
    res.redirect("/stations/" + cityId)
  }
})

app.post("/initmap", function(req,res){
  dbClient.query("SELECT cityname, abocities.id AS id, latitude, longitude FROM (SELECT * FROM cities WHERE cities.email = $1) AS abocities LEFT JOIN (SELECT readings.* FROM readings JOIN (SELECT cityid, MAX(id) AS MaxID FROM readings GROUP BY cityid) groupdates ON readings.id = groupdates.MaxID AND readings.cityid = groupdates.cityid AND readings.email = $1) AS singlecity ON abocities.id = singlecity.cityid", [req.session.user], function (dbError, dbResponse) {
    if (dbResponse.rows.length !== 0) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({cities: dbResponse.rows}));
    }
  })
})

app.listen(PORT, function () {
  console.log(`Weathertop running and listening on port ${PORT}`);
});

function isloggedin(user, res){
  if(user !== undefined){
    return true;
  }
  else{
    res.render("signup", { login_error: "Du musst angemeldet sein, um darauf zuzugreifen!" });
    return false;
  }
}

async function trends(user, cityId){
  var i = {
    trend: {
      temperatur: {
        icon: "app"
      },
      wind: {
        icon: "app"
      },
      luftdruck: {
        icon: "app"
      }
    }
  };
  const TrendResponse = await dbClient.query("SELECT temperatur, wind, luftdruck, id FROM readings WHERE email = $1 AND cityid = $2 ORDER BY id DESC LIMIT 2", [user, cityId])
  if(TrendResponse.rows.length === 2){
    i.trend.temperatur.icon = trendparse(TrendResponse.rows[1].temperatur, TrendResponse.rows[0].temperatur);
    i.trend.wind.icon = trendparse(TrendResponse.rows[1].wind, TrendResponse.rows[0].wind);
    i.trend.luftdruck.icon = trendparse(TrendResponse.rows[1].luftdruck, TrendResponse.rows[0].luftdruck);
  }
  return i;
}


function trendparse(previous, newest){
  if(previous < newest){
    return "arrow-up-right"
  }
  else if(previous > newest){
    return "arrow-down-right";
    
  }
  else if(previous === newest){
    return "arrow-right";
  }
  else{
    return "app"
  }
}

function windparse(wind) {
  if (wind === null) {
    return {
      Richtung: ""
    };
  }
  else if ((wind <= 11.25 && wind >= 0) || (wind > 348.75 && wind <= 360)) {
    return {
      Richtung: "Nord",
    };
  }
  else if (wind <= 33.75 && wind > 11.25) {
    return {
      Richtung: "Nord Nord-Ost",
    };
  }
  else if (wind <= 56.25 && wind > 33.75) {
    return {
      Richtung: "Nord-Ost",
    };
  }
  else if (wind <= 78.75 && wind > 56.25) {
    return {
      Richtung: "Ost Nord-Ost",
    };
  }
  else if (wind <= 101.25 && wind > 78.75) {
    return {
      Richtung: "Ost",
    };
  }
  else if (wind <= 123.75 && wind > 101.25) {
    return {
      Richtung: "Ost Süd-Ost",
    };
  }
  else if (wind <= 146.25 && wind > 123.75) {
    return {
      Richtung: "Süd-Ost",
    };
  }
  else if (wind <= 168.75 && wind > 146.25) {
    return {
      Richtung: "Süd Süd-Ost",
    };
  }
  else if (wind <= 191.25 && wind > 168.75) {
    return {
      Richtung: "Süd",
    };
  }
  else if (wind <= 213.75 && wind > 191.25) {
    return {
      Richtung: "Süd Süd-West",
    };
  }
  else if (wind <= 236.25 && wind > 213.75) {
    return {
      Richtung: "Süd-West",
    };
  }
  else if (wind <= 258.75 && wind > 236.25) {
    return {
      Richtung: "West Süd-West",
    };
  }
  else if (wind <= 281.25 && wind > 258.75) {
    return {
      Richtung: "West",
    };
  }
  else if (wind <= 303.75 && wind > 281.25) {
    return {
      Richtung: "West Nord-West",
    };
  }
  else if (wind <= 326.25 && wind > 303.75) {
    return {
      Richtung: "Nord-West",
    };
  }
  else if (wind <= 348.75 && wind > 326.25) {
    return {
      Richtung: "Nord Nord-West",
    };
  }
  else {
    return {
      Richtung: ""
    }
  }
}

function wetterparse(wetter) {
  if (wetter >= 200 && wetter <300) {
    return {
      icon: "cloud-lightning",
      text: "Sturm"
    }
  }
  else if (wetter >= 300 && wetter <400) {
    return {
      icon: "cloud-drizzle",
      text: "leichter Regen"
    }
  }
  else if (wetter >= 500 && wetter <600) {
    return {
      icon: "cloud-rain",
      text: "Regen"
    }
  }
  else if (wetter >= 600 && wetter <700) {
    return {
      icon: "cloud-snow",
      text: "Schnee"
    }
  }
  else if (wetter >= 700 && wetter <800) {
    return {
      icon: "cloud-fog",
      text: "Nebelig"
    }
  }
  else if (wetter === 800) {
    return {
      icon: "sun",
      text: "Sonne"
    }
  }
  else if(wetter > 800 && wetter <900){
    return {
      icon: "cloud",
      text: "Wolkig"
    }
  }
  else {
    return {
      icon: "app",
      text: ""
    }
  }
}


async function automaticadd(cityId, latitude, longitude, user, res){  
  var zeitpunkt = new Date();
  var date = zeitpunkt.toString();
  
  var Request = 'https://api.openweathermap.org/data/2.5/onecall?lat='+latitude+'&lon='+longitude+'&units=metric&appid=f056af070b3bf3b0532587880c466c3d'
  let report = {};
    const result = await axios.get(Request);
    if (result.status == 200) {
      const reading = result.data.current;
      report.code = reading.weather[0].id;
      report.temperature = reading.temp;
      report.windSpeed = reading.wind_speed;
      report.pressure = reading.pressure;
      report.windDirection = reading.wind_deg;
  }

  dbClient.query("INSERT INTO readings (cityid, wetter, temperatur, wind, luftdruck, zeitpunkt, windrichtung, email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",[cityId,report.code,report.temperature,report.windSpeed,report.pressure,date, report.windDirection, user],function(dbError,dbResponse){
    
  })
  res.redirect("/stations/" + cityId);
}
