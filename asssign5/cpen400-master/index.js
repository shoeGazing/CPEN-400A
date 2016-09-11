var express = require('express')
var bodyParser = require('body-parser');

var mongodb = require('mongodb')

// init db connection
var dbServer = new mongodb.Server('localhost', 27017, { auto_reconnect: true });

// ATTENTION: test is the name of the database we are using, not the name of the collection
var db = new mongodb.Db('test', dbServer, { safe: true })
db.open(function (err) {
    // we have no chance to close this connection, hope mongodb will recycle it automatically.
    if (err)
        console.log("Can not open database!");
});

// init web server
var app = express()
app.set('port', (process.env.PORT || 5000))
app.use(express.static(__dirname + '/public'))
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded, this is essential

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

var tokens = {};
// get all tokens
db.collection('users', { safe: true }, function (err, collection) {
    if (err) {
        console.log("Can not get any token" + err);
    } else {
        collection.find({}).toArray(function (err, data) {
            for (i = 0; i < data.length; i = i + 1) {
                tokens[data[i].token] = true;
            }
        });
    }
})

function checkToken(token) {
    if (!token) return false;
    if (!tokens[token]) return false;
    return true;
}

app.get('/products', function (request, response) {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    if (!checkToken(request.query.token)) {
        console.log("invalid token");
        response.status(401).send("Invalid Token");
        return;
    }

    // get collection
    db.collection('products', { safe: true }, function (err, collection) {
        if (err) {
            response.status(500).send("Collection 'products' not found" + err);
        } else {
            collection.find().toArray(function (err, docs) {
                retObj = {};
                for (i = 0; i < docs.length; ++i) {
                    obj = docs[i];
                    retObj[obj['name']] = {price : obj['price'], quantity : obj['quantity'], url : obj['url']};
                }

                response.send(retObj);
            });
        }
    });
})

// for checkout use
app.post('/checkout', function (req, resp) {

    //ATTENTION: CORS
    resp.header("Access-Control-Allow-Origin", "*");
    resp.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    if (!checkToken(req.body['token'])) {
        console.log("invalid token");
        resp.status(401).send("Invalid Token");
        return;
    }


    if (!req.body || !req.body['cartObj'] || !req.body['total']) {
        console.log("Post cart info")
        resp.status(500).send("Post cart info is empty");
        return;
    }

    db.collection('products', { safe: true }, function (err, collection) {
        if (err) {
            console.log(err);
            resp.status(500).send("Collection 'products' not found.\n" + err);
        } else {
            cart = req.body['cartObj'];
            cartSum = req.body['total'];

            // generate search filter
            conds = {};
            cond = conds['$or'] = [];

            for (item in cart) {
                cond.push({ name: item });
            }
            // go search
            collection.find(conds).toArray(function (e, data) {
                if (e)
                {
                    resp.status(500).send("Fetch data error: \n");
                    return;
                }
                sum = 0;
                inventory = {};

                // check inventory & calculate subtotal
                for (i = 0; i < data.length; i = i + 1) {
                    n = cart[data[i]['name']];
                    m = data[i]['quantity'] - n;
                    if (m < 0) {
                        resp.status(500).send("Insufficient " + data[i]['name'] + "\n Please retry");
                        return;
                    }
                    sum = sum + n * data[i]['price'];
                    inventory[data[i]['name']] = m;
                }

                if (sum != cartSum)
                {
                    resp.status(500).send("Price has changed, please review your cart");
                    return;
                }

                // handle vailid order
                // transaction is not supported by mongodb, so we just assume no issue will happen when we updating database
                for (item in cart) {
                    collection.updateOne({ name: item }, { "$set": { 'quantity': inventory[item] } });
                }

                // log this order
                // we do NOT guarantee all orders could be logged.
                db.collection('orders', { safe: true }, function (err, collection) {
                    if (!err) {
                        collection.insertOne({cart: cart, total : cartSum});
                    }
                    resp.send("Thanks for your purchasing :)");
                });
            });
        }
    });


});

app.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'))
})
