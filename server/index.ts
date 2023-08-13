/* eslint-disable @typescript-eslint/no-unused-vars */
// Libraries
import connectMongoDBSession from "connect-mongodb-session";
import cors from "cors";
import express, { Express, Request, Response } from "express";
import session from "express-session";
import mongoose from "mongoose";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import path from 'path';
import { fileURLToPath } from 'url';
import "./configs/db.ts";
import { CLIENT_DB, CLIENT_ID, CLIENT_SECRET, SERVER_PORT } from "./configs/env.ts";
import encrypts from "./modules/encryption.ts";
import mongoFuncs from "./modules/mongoDB.ts";

// File Path Initialization
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express Initialization
const app: Express = express();

//Library Initialization
app.use(express.json());
app.use(cors());
app.set('trust proxy', true);

const SECRET: string = encrypts.permanentEncryptPassword(encrypts.generateRandomNumber(256, "alphanumeric"))

// Globals
var userDataID: string = "";

// MongoDB Credentials
const MongoDBStore = connectMongoDBSession(session);

app.use(session({
    secret: SECRET,
    resave: false,
    saveUninitialized: true,
    store: new MongoDBStore({
        uri: process.env.MONGODB_URI!,
        collection: "SchedulesSessions",
        expires: 1000 * 60 * 60 * 24 * 7, // 1 week
        databaseName: CLIENT_DB,
        idField: "_id",
        expiresKey: "sessionTime",
        expiresAfterSeconds: 1000 * 60 * 60 * 24 * 7 // 1 week
    }),
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 3.5, // 3.5 days
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(
    new GoogleStrategy(
        {
            clientID: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            callbackURL: "http://127.0.0.1:3001/auth/google/callback"
        },
        (accessToken, refreshToken, profile, done) => {
            return done(null, profile);
        }
    )
);

mongoFuncs.deleteFromDatabase({}, "SchedulesSessions", "many", true)

// Google OAuth2 Credentials
passport.serializeUser((user: any, done: any) => {
    done(null, user);
});

passport.deserializeUser((user: any, done: any) => {
    done(null, user);
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"], }));
app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "/login" }), async (req: Request, res: Response) => {
    const user = req.user as any;

    console.log(user);

    const validEmailDomains = ["student.auhsd.us"];

    if (validEmailDomains.includes(user._json.hd)) {
        // Generate a random 64 bit string that's also encrypted
        const dataIDRandom: string = encrypts.permanentEncryptPassword(encrypts.generateRandomNumber(64, "alphanumeric"));

        userDataID = dataIDRandom;

        const fileData: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { email: user._json.email })) || -1;

        if (fileData === -1) {
            const newUser: any = {
                displayName: user.displayName,
                firstName: user.name.givenName,
                lastName: user.name.familyName,
                email: user.emails[0].value,
                profilePicture: user.photos[0].value,
                schedule: {
                    P1: "",
                    P2: "",
                    P3: "",
                    P4: "",
                    P5: "",
                    P6: "",
                    P7: "",
                    P8: "",
                },
                siteUsername: "",
                sitePassword: "",
                settings: {
                    grade: "",
                    theme: "dark",
                    visible: "public", // public, private, friends, unlisted
                    friends: [],
                    blocked: [],
                    canLogInMultipleDevices: true,
                },
                unlistedSettings: {
                    isTerminated: false,
                    isStudent: true,
                    isTeacher: false,
                },
                dataIDNumber: dataIDRandom,
            }

            const write = await mongoFuncs.writeToDatabase(newUser, "SchedulesUsers", true) || false;

            if (write) {
                res.redirect("http://localhost:3000/home");
            } else {
                res.redirect("http://localhost:3000/login");
            }
        } else {
            const findExistingData: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { email: user._json.email }));

            findExistingData.dataIDNumber = dataIDRandom;

            const updateExistingData: boolean = await mongoFuncs.modifyInDatabase({ email: user._json.email }, findExistingData, "SchedulesUsers", true);

            if (updateExistingData) {
                res.redirect("http://localhost:3000/home");
            } else {
                res.redirect("http://localhost:3000/login");
            }
        }
    } else {
        res.redirect("http://localhost:3000/login");
    }
});

app.post('/api/saveperiods', async (req: Request, res: Response) => {
    const data: any = req.body;

    const findExistingData: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { dataIDNumber: userDataID }));

    findExistingData.schedule = data.periods;
    findExistingData.settings.grade = data.currentGrade;

    const updateExistingData: boolean = await mongoFuncs.modifyInDatabase({ dataIDNumber: userDataID }, findExistingData, "SchedulesUsers", true);

    if (updateExistingData) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});

app.get("/api/getstudentdata", async (req: Request, res: Response) => {
    const data: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { dataIDNumber: userDataID }));
    res.send(data);
});

app.get("/api/getteachers", async (req: Request, res: Response) => {
    const data: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("TeachersAvailable", true));

    res.send(data);
});

app.get("/api/getstudentschedules", async (req: Request, res: Response) => {
    const data: any[] = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true));

    let newData: any[] = [];

    for (let i = 0; i < data.length; i++) {
        try {
            if (data[i].settings.visible === "public") {
                if (data[i].schedule.length > 0) {
                    let newDataItem: any = {};

                    newDataItem.displayName = data[i].displayName;
                    newDataItem.studentID = data[i].email.split("@")[0];
                    newDataItem.schedule = data[i].schedule;
                    newDataItem.grade = data[i].settings.grade;
                    newDataItem.profilePicture = data[i].profilePicture;

                    newData.push(newDataItem);
                }
            }
        } catch (err) {
            console.log(err);
            console.log("Error with user: " + data[i].displayName);
            console.log("Data:" + JSON.stringify(data[i]));
        }
    }

    console.log(newData);

    res.send(newData);
});

app.get('/api/getallusersettings', async (req: Request, res: Response) => {
    const data: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { dataIDNumber: userDataID }));

    let newData: any[] = [];

    try {
        let newDataItem: any = {};

        newDataItem.displayName = data.displayName;
        newDataItem.studentID = data.email.split("@")[0];
        newDataItem.grade = data.settings.grade;
        newDataItem.settings = data.settings;

        newData.push(newDataItem);
    } catch (err) {
        console.log(err);
        console.log("Error with user: " + data.displayName);
        console.log("Data:" + JSON.stringify(data));
    }

    res.send(newData);
});

app.post('/api/savesettings', async (req: Request, res: Response) => {
    const data: any = req.body;

    const findExistingData: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { dataIDNumber: userDataID }));

    findExistingData.firstName = data.firstName;
    findExistingData.lastName = data.lastName;
    findExistingData.displayName = data.firstName + " " + data.lastName;
    findExistingData.siteUsername = data.username;
    findExistingData.sitePassword = encrypts.permanentEncryptPassword(data.password);
    findExistingData.settings.visible = data.visible;
    findExistingData.settings.grade = data.grade;

    const updateExistingData: boolean = await mongoFuncs.modifyInDatabase({ dataIDNumber: userDataID }, findExistingData, "SchedulesUsers", true);

    if (updateExistingData) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});

app.post('/user/login', async (req: Request, res: Response) => {
    const data: any = req.body;

    const findExistingData: any = JSON.parse(await mongoFuncs.getItemsFromDatabase("SchedulesUsers", true, { siteUsername: data.username }));

    if (await encrypts.comparePassword(data.password, findExistingData.sitePassword)) {
        res.sendStatus(200);
    } else {
        res.sendStatus(500);
    }
});

// GOOGLE OAUTH FIX DOCUMENTATION
// Use the code below for your build.
// IMPORTANT: Make sure that this code is placed AFTER the /google/auth (or equivalent) and /google/auth/callback (or equivalent) route.

app.use(express.static(path.join(__dirname, '..', 'public')));

// Handle all other routes by serving the 'index.html' file
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(SERVER_PORT, () => {
    console.log(`Server is running on port ${SERVER_PORT}`);
});

process.on("SIGINT", async () => {
    console.log("Shutting down server...");

    await mongoFuncs.deleteFromDatabase({}, "SchedulesUsers", "many", true)

    await mongoose.connection.close();

    process.exit();
});