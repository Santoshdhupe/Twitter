const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken"); 
const path = require("path");

const app = express();
app.use(express.json());

let dataBase = null; 

const initializeDBAndServer = async () => {
    try {
        dataBase = await open({
            filename: path.join(__dirname, "twitterClone.db"),
            driver: sqlite3.Database
        });
        app.listen(4000, () => {
            console.log("Sever running at http://localhost:4000/")
        })
    } catch (error) {
        console.log(`DB Error: ${error.message}`);
        process.exit(1);
    };
}; 

initializeDBAndServer(); 

const authenticateToken = (request, response, next) => {
    let jwtToken;
    const authHeader = request.headers["authorization"];
    if (authHeader !== undefined) {
      jwtToken = authHeader.split(" ")[1];
    }
    if (jwtToken === undefined) {
       response.status(401);
       response.send("Invalid JWT Token");
    } else {
       jwt.verify(jwtToken, "my_secret_code", async (error, payload) => {
       if (error) {
           response.status(401);
          response.send("Invalid JWT Token");
        } else { 
           request.userId = payload.userId;
           request.username = payload.username;
           next();
        }
    });
  }
}; 

const getFollowingPeopleIdsOfUser = async (username) => {
    const getFollowingPeopleIdsQuery = 
    `SELECT following_user_id FROM follower 
    INNER JOIN user on user.user_id = follower.follower_user_id 
    WHERE user.username = '${username}';`; 
    const getFollowingPeople = await dataBase.all(getFollowingPeopleIdsQuery);
    const followingPeopleIds = getFollowingPeople.map((eachPerson) => eachPerson.following_user_id); 
    return followingPeopleIds;
}; 

const tweetAccessVerification = async (request, response, next) => {
    const {userId} = request;
    const {tweetId} = request.params;
    const getTweetQuery = 
    `SELECT * FROM tweet INNER JOIN follower ON 
    tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId};'`;
    const tweet = await dataBase.get(getTweetQuery);
    if (tweet === undefined) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        next();
    };    
};

app.post("/register/", async (request, response) => {
    const { username, password, name, gender } = request.body; 
    const checkUserQuery = 
    `SELECT * FROM user WHERE username = '${username}';`; 
    const checkUser = await dataBase.get(checkUserQuery); 
    if (checkUser === undefined) {
        if (password.length >= 6 ) { 
            const hashedPassword  = await bcrypt.hash(password, 10);            
            const addUserQuery = 
            `INSERT INTO user ( name, username, password, gender)
            VALUES ('${name}', '${username}', '${hashedPassword}', '${gender}');`;
            await dataBase.run(addUserQuery);
            response.status(200);
            response.send("User created successfully");            
        } else { 
            response.status(400);
            response.send("Password is too short");
        };
    } else {
        response.status(400);
        response.send("User already exists");
    } ;   
}); 

app.post("/login/", async (request, response) => {
    const {username, password} = request.body;
    const checkUserQuery = 
    `SELECT * FROM user WHERE username = '${username}';`;
    const checkUser = await dataBase.get(checkUserQuery);
    if (checkUser === undefined) {
        response.status(400);
        response.send("Invalid user");
    } else {
        const checkPasswordMatch = await bcrypt.compare(password, checkUser.password); 
        if (checkPasswordMatch == true) {
            const payload = { username, userId: checkUser.user_id };
            const jwtToken = jwt.sign(payload, "my_secret_code"); 
            response.send({jwtToken});
        } else {
            response.status(400);
            response.send("Invalid password");
        };
    };
});  



app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
    const {username} = request;

    const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
    
    const getTweetsFeedQuery = 
    `SELECT username, tweet, date_time as dateTime 
    FROM user INNER JOIN tweet on user.user_id = tweet.user_id WHERE user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC LIMIT 4 ;`; 
    const getTweetsFeed = await dataBase.all(getTweetsFeedQuery) ;
    response.send(getTweetsFeed);
});  


app.get("/user/following/",authenticateToken, async (request, response) => { 
    const {username, userId} = request;
    const getFollowingQuery = 
    `SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id 
    WHERE follower_user_id = '${userId}';`;

    const getFollowing = await dataBase.all(getFollowingQuery);
    response.send(getFollowing);   
}); 


app.get("/user/followers/",authenticateToken, async (request, response) => { 
    const {username, userId} = request;
    const getFollowersQuery = 
    `SELECT DISTINCT name FROM follower INNER JOIN  user ON user.user_id = follower.follower_user_id 
    WHERE following_user_id = '${userId}';`;

    const getFollowers = await dataBase.all(getFollowersQuery);
    response.send(getFollowers);   
}); 

app.get("/tweets/:tweetId/", authenticateToken, tweetAccessVerification, async (request, response) =>{
    const {username, userId} = request;
    const {tweetId} = request.params;
    const getIdTweetQuery = 
    ` SELECT tweet, 
    (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime FROM tweet WHERE tweet.tweet_id = ${tweetId};`;

    const getIdTweet = await dataBase.get(getIdTweetQuery);
    response.send(getIdTweet);
});


app.get("/tweets/:tweetId/likes/", authenticateToken, tweetAccessVerification, async (request, response) =>{
    const {tweetId} = request.params;
    const getLikesQuery = 
    `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id 
    WHERE tweet_id = ${tweetId};`;

    const likedUsers = await dataBase.all(getLikesQuery); 
    const users = likedUsers.map((each) => each.username);
    response.send({ likes: users });
});


app.get("/tweets/:tweetId/replies/", authenticateToken, tweetAccessVerification, async (request, response) =>{
    const {tweetId} = request.params;
    const getRepliesQuery = 
    `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id 
    WHERE tweet_id = ${tweetId};`;

    const getRepliedUsers = await dataBase.all(getRepliesQuery); 
    response.send({ replies: getRepliedUsers });
});


app.get("/user/tweets/", authenticateToken, async (request, response) => {
    const {userId} = request;
    const getTweetsQuery = 
    `SELECT tweet,
    COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime 
    FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;` ;
    const tweets = await dataBase.all(getTweetsQuery);
    response.send(tweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
    const { tweet } = request.body ;
    const userId = parseInt(request.userId);
    const dateTime = new Date().toJSON().substring(0, 19).replace("T", " "); 
    const  postTweetQuery = 
    `INSERT INTO tweet (tweet, user_id, date_time) 
    VALUES ('${tweet}', '${userId}', '${dateTime}');`;
    await dataBase.run(postTweetQuery);
    response.send("Created a Tweet");
       
}); 


app.delete("/tweets/:tweetId/",authenticateToken, async (request, response) => {
    const {tweetId} = request.params;
    const {userId} = request;
    const getTweetQuery = 
    `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`; 
    const tweet = await dataBase.get(getTweetQuery);
    if (tweet === undefined) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        const deleteTweetQuery = 
        `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`; 
        await dataBase.run(deleteTweetQuery);
        response.send("Tweet Removed");
    };
});

module.exports = app;



