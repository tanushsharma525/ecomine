if(process.env.NODE_ENV != 'production')
{
    require('dotenv').config();
}

const express = require('express');
const app = express();
const path = require('path');
const methodOverride = require('method-override');
const mongoose = require('mongoose');
const ejsMate = require('ejs-mate');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const maptilerClient = require("@maptiler/client");
const csv = require('csv-parser');
const fs = require('fs');

// Add error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

// Configure maptiler only if API key exists
if (process.env.MAPTILER_API_KEY) {
    maptilerClient.config.apiKey = process.env.MAPTILER_API_KEY;
} else {
    console.warn('Warning: MAPTILER_API_KEY not found in environment variables');
}

const Mines = require('./models/mines');
const User = require('./models/user');
const places = require('./data/india-places');
const marketplaceRoutes = require('./marketplace/marketplace');
const authRoutes = require('./auth/auth');
const isAuthenticated = require('./auth/auth');

app.engine('ejs', ejsMate);
app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'pages'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static('pages'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(cors());

// Session configuration
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGODB_URL || 'mongodb+srv://newcluster:newcluster@cluster0.kxfq0rm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
        touchAfter: 24 * 3600
    }),
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
};


app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            const user = await User.findById(req.session.userId);
            res.locals.currentUser = user;
        } catch (err) {
            console.error('Session user lookup error:', err);
            res.locals.currentUser = null;
        }
    } else {
        res.locals.currentUser = null;
    }
    next();
});

// MongoDB connection with retry logic
const connectWithRetry = () => {
    const mongoUrl = process.env.MONGODB_URL || 'mongodb+srv://newcluster:newcluster@cluster0.kxfq0rm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    console.log('Attempting to connect to MongoDB at:', mongoUrl.replace(/\/\/[^@]+@/, '//****:****@'));

    mongoose.connect(mongoUrl, {
        dbName: 'ecomine'
    })
    .then(() => {
        console.log("✅ MONGO CONNECTION OPEN!!!");
    })
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err.message);
        console.log("🔁 Retrying in 5 seconds...");
        setTimeout(connectWithRetry, 5000);
    });
};


// Add MongoDB connection event handlers
mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected. Attempting to reconnect...');
    connectWithRetry();
});

mongoose.connection.on('connected', () => {
    console.log('MongoDB connected successfully');
});

// Start the connection
connectWithRetry();

app.use('/', authRoutes);

// Add root route handler
app.get("/", (req, res) => {
    if (req.session && req.session.userId) {
        res.redirect('/home');
    } else {
        res.redirect('/login');
    }
});

app.get("/home", (req, res) => {
    res.render("home");
})

app.get("/about", (req, res) => {
    res.render("aboutus");
})

app.get("/suggest", (req, res) => {
    res.render("suggest");
})

app.post("/index", isAuthenticated, async (req, res) => {
    try {
        const geox = (req.body.Mine.district +", " + req.body.Mine.state);
        console.log(geox)
        const geoData = await maptilerClient.geocoding.forward((geox), { limit: 1 });        
        const mineData = req.body.Mine;
        const mine = new Mines(mineData); 
        mine.geometry = geoData.features[0].geometry;
        mine.user = req.session.userId;
        await mine.save();
        res.redirect("/index");
    } catch (err) {
        console.error("Error adding mine:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/index", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.redirect("/login");
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.redirect('/login');
        }

        const mines = await Mines.find({ user: user._id });
        res.render("index", { mines, heroVideo: true, currentUser: user }); // ← also fix this line if needed
    } catch (err) {
        console.error("Error fetching mines:", err);
        res.status(500).send("Internal Server Error");
    }
});



app.get("/calculate",(req, res) => {
    res.render("calculate", {places});
});

app.get("/index/:id/suggestions",(req, res) => {
    res.render("suggestions");
});

app.get("/index/:id", async (req, res) => {
    try {
        const data = [];
        const mines = await Mines.findById(req.params.id);
        if (!mines) {
            return res.status(404).send("Mine not found");
        }
        fs.createReadStream('./mine_data3.csv')
          .pipe(csv())
          .on('data', (row) => {
            data.push(row);
          })
          .on('end', () => {
            res.render('show', { mines, mineData: data });
          });
    } catch (err) {
        console.error("Error fetching mine:", err);
        res.status(500).send("Internal Server Error");
    }
});
app.get('/methane', (req, res) => {
  res.render('methane'); // Adjust path if needed
});

app.delete("/index/:id", async (req, res) => {
    try {
        const mines = await Mines.findByIdAndDelete(req.params.id);
        if (!mines) {
            return res.status(404).send("Mine not found");
        }
        res.redirect("/index");
    } catch (err) {
        console.error("Error deleting mine:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.put("/index/:id", async (req, res) => {
    try {
        const geox = (req.body.Mine.district +", " + req.body.Mine.state);
        const mines = await Mines.findByIdAndUpdate(req.params.id, req.body.Mine, { new: true });
        const geoData = await maptilerClient.geocoding.forward((geox), { limit: 1 });   
        mines.geometry = geoData.features[0].geometry;
        if (!mines) {
            return res.status(404).send("Mine not found");
        }
        await mines.save();
        res.redirect(`/index/${mines.id}`);
    } catch (err) {
        console.error("Error updating mine:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get("/index/:id/edit", async (req, res) => {
    try {
        const mines = await Mines.findById(req.params.id);
        if (!mines) {
            return res.status(404).send("Mine not found");
        }
        res.render("edit", { mines, places });
    } catch (err) {
        console.error("Error fetching mine for edit:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.get('/getCities', (req, res) => {
    try {
        const state = req.query.state;
        const selectedState = places.states.find(s => s.name === state);
        const cities = selectedState ? selectedState.districts.map(d => d.name) : [];
        res.json(cities);
    } catch (err) {
        console.error("Error fetching cities:", err);
        res.status(500).send("Internal Server Error");
    }
});

app.use('/marketplace', marketplaceRoutes);

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).render('error', { 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// Start server with error handling
const port = process.env.PORT || 3001;

const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Trying again in 5 seconds...`);
        setTimeout(() => {
            server.close();
            server.listen(port, '0.0.0.0');
        }, 5000);
    } else {
        console.error('Server error:', err);
    }
});
