const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const {MongoClient, ServerApiVersion, ObjectId, Timestamp} = require('mongodb');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;
    console.log(token);
    if (!token) {
        return res.status(401).send({message: 'unauthorized access'});
    }
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.log(err);
            return res.status(401).send({message: 'unauthorized access'});
        }
        req.user = decoded;
        next();
    });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@ecommercedatabase.la5qrjd.mongodb.net/?retryWrites=true&w=majority&appName=ecommerceDatabase`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        const roomCollection = client.db('stayVista').collection('rooms');
        const userCollection = client.db('stayVista').collection('users');
        const bookingCollection = client.db('stayVista').collection('bookings');

        // auth related api0
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '365d',
            });
            res.cookie('token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite:
                    process.env.NODE_ENV === 'production' ? 'none' : 'strict',
            }).send({success: true});
        });
        // Logout
        app.get('/logout', async (req, res) => {
            try {
                res.clearCookie('token', {
                    maxAge: 0,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite:
                        process.env.NODE_ENV === 'production'
                            ? 'none'
                            : 'strict',
                }).send({success: true});
                console.log('Logout successful');
            } catch (err) {
                res.status(500).send(err);
            }
        });

        // Create payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const {price} = req.body;
            if (price < 0) return;
            const totalPrice = parseFloat(price) * 100;
            const {client_secret} = await stripe.paymentIntents.create({
                amount: totalPrice,
                currency: 'usd',
                automatic_payment_methods: {
                    enabled: true,
                },
            });
            res.send({clientSecret: client_secret});
        });

        // Booking related api, Payment History
        app.post('/booking', async (req, res) => {
            const paymentInfo = req.body;
            const result = bookingCollection.insertOne(paymentInfo);
            res.send(result);
        });

        // Update status: true after booked room
        app.patch('/update-status/:id', async (req, res) => {
            const id = req.params.id;
            const {status} = req.body;
            const query = {_id: new ObjectId(id)};
            const updatedDoc = {
                $set: {
                    status: status,
                },
            };
            const result = await roomCollection.updateOne(query, updatedDoc);
            res.send(result);
        });

        // User related api's

        app.get('/users', async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        });

        app.get('/user/:email', async (req, res) => {
            const email = req.params.email;
            const result = await userCollection.findOne({email});
            res.send(result);
        });

        app.put('/user', async (req, res) => {
            const user = req.body;
            const query = {email: user.email};
            // Check is exist user
            const isExistUser = await userCollection.findOne(query);
            if (isExistUser) {
                if (user.status === 'Requested') {
                    // Update Status
                    const updatedStatus = {$set: {status: user?.status}};
                    const result = await userCollection.updateOne(
                        query,
                        updatedStatus
                    );
                    return res.send(result);
                } else {
                    return res.send(isExistUser);
                }
            }

            const options = {upsert: true};
            const updatedDoc = {
                $set: {
                    ...user,
                    Timestamp: Date.now(),
                },
            };
            const result = await userCollection.updateOne(
                query,
                updatedDoc,
                options
            );
            res.send(result);
        });

        app.patch('/user/:email', async (req, res) => {
            const email = req.params.email;
            const status = req.body;
            const query = {email: email};
            console.log('status ->>', status);
            const updatedDoc = {
                $set: {
                    status: status.status,
                },
            };
            const result = await userCollection.updateOne(query, updatedDoc);
            res.send(result);
        });

        app.patch('/update-role/:email', async (req, res) => {
            const email = req.params.email;
            const updateRole = req.body;
            const query = {email: email};
            const updatedDoc = {
                $set: {
                    role: updateRole.role,
                    status: updateRole.status,
                },
            };
            const result = await userCollection.updateMany(query, updatedDoc);
            res.send(result);
        });

        // Rooms related api's
        app.get('/rooms', async (req, res) => {
            const category = req.query.category;
            let query = {};
            if (category !== 'null') {
                query = {category: category};
            }
            const result = await roomCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/room/:id', async (req, res) => {
            const id = req.params.id;
            if (!ObjectId.isValid(id)) {
                return res.status(400).send({error: 'Invalid ObjectId format'});
            }
            const query = {_id: new ObjectId(id)};
            const result = await roomCollection.findOne(query);
            res.send(result);
        });

        app.get('/my-listings/:email', async (req, res) => {
            const email = req.params.email;
            console.log(email);
            const query = {'host.email': email};
            const result = await roomCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/rooms', async (req, res) => {
            const roomData = req.body;
            const result = await roomCollection.insertOne(roomData);
            res.send(result);
        });

        app.delete('/room/:id', async (req, res) => {
            const id = req.params.id;
            const query = {_id: new ObjectId(id)};
            const result = await roomCollection.deleteOne(query);
            res.send(result);
        });

        // Send a ping to confirm a successful connection
        await client.db('admin').command({ping: 1});
        console.log(
            'Pinged your deployment. You successfully connected to MongoDB!'
        );
    } finally {
        // Ensures that the client will close when you finish/error
        //await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello from StayVista Server..');
});

app.listen(port, () => {
    console.log(`StayVista is running on port ${port}`);
});
