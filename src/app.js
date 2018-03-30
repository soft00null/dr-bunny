
'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN ='2a6d0016758f44529c740ac75ed60268';
const APIAI_LANG = process.env.APIAI_LANG || 'en';
const FB_VERIFY_TOKEN = 'crowdbotics';
const FB_PAGE_ACCESS_TOKEN = 'EAAFKz90Ob0MBAIuYp8JeYHR5IpSpSIyUn1JYEQhDyaVYyXExpeC4u98LiQ0pMaVZCF2EOUwlv5RmnnJCYfBj3BHBQMvDtuODbElOv7dJIZCQgGBZC7zZCWx7eW0hQNkx9rFs4mXag31CcsdGOBwNY0ZCJAEYEFyHNpTHRbFGl7ZBTBWxsBKlap';
const FB_TEXT_LIMIT = 640;

const FACEBOOK_LOCATION = "FACEBOOK_LOCATION";
const FACEBOOK_WELCOME = "FACEBOOK_WELCOME";

//default latlong
global.latlang = 'default ';


//TWILIO details

const accountSid = 'AC18099cc16bcb7cad38177fb9ac2475b7';
const authToken = 'f0fe3984431a458512b95c72641893da';
const Twilio = require('twilio');
const client = new Twilio(accountSid, authToken);




//firebase start
const admin = require('firebase-admin');

var serviceAccount = require('./privateKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

var db = admin.firestore();
//end firebase

//msg91 settings
const SendOtp = require('sendotp');

const sendOtp = new SendOtp('202689Au6teNJGhC05aa7e796');

//end of msg 91



class FacebookBot {
    constructor() {
        this.apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
        this.sessionIds = new Map();
        this.messagesDelay = 200;
    }


    doDataResponse(sender, facebookResponseData) {
        if (!Array.isArray(facebookResponseData)) {
            console.log('Response as formatted message');
            this.sendFBMessage(sender, facebookResponseData)
                .catch(err => console.error(err));
        } else {
            async.eachSeries(facebookResponseData, (facebookMessage, callback) => {
                if (facebookMessage.sender_action) {
                    console.log('Response as sender action');
                    this.sendFBSenderAction(sender, facebookMessage.sender_action)
                        .then(() => callback())
                        .catch(err => callback(err));
                }
                else {
                    console.log('Response as formatted message');
                    this.sendFBMessage(sender, facebookMessage)
                        .then(() => callback())
                        .catch(err => callback(err));
                }
            }, (err) => {
                if (err) {
                    console.error(err);
                } else {
                    console.log('Data response completed');
                }
            });
        }
    }

    doRichContentResponse(sender, messages) {
        let facebookMessages = []; // array with result messages

        for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
            let message = messages[messageIndex];

            switch (message.type) {
                //message.type 0 means text message
                case 0:
                    // speech: ["hi"]
                    // we have to get value from fulfillment.speech, because of here is raw speech
                    if (message.speech) {

                        let splittedText = this.splitResponse(message.speech);
                        console.log("splitted text:"+splittedText);

                        splittedText.forEach(s => {
                            facebookMessages.push({text: s});
                        });
                    }

                    break;
                //message.type 1 means card message
                case 1: {
                    let carousel = [message];
                    

                    for (messageIndex++; messageIndex < messages.length; messageIndex++) {
                        if (messages[messageIndex].type == 1) {
                            carousel.push(messages[messageIndex]);
                        } else {
                            messageIndex--;
                            break;
                        }
                    }

                    let facebookMessage = {};
                    carousel.forEach((c) => {
                        // buttons: [ {text: "hi", postback: "postback"} ], imageUrl: "", title: "", subtitle: ""

                        let card = {};

                        card.title = c.title;
                        card.image_url = c.imageUrl;
                        if (this.isDefined(c.subtitle)) {
                            card.subtitle = c.subtitle;
                        }
                        //If button is involved in.
                        if (c.buttons.length > 0) {
                            let buttons = [];
                            for (let buttonIndex = 0; buttonIndex < c.buttons.length; buttonIndex++) {
                                let button = c.buttons[buttonIndex];

                                if (button.text) {
                                    let postback = button.postback;
                                    if (!postback) {
                                        postback = button.text;
                                    }

                                    let buttonDescription = {
                                        title: button.text
                                    };

                                    if (postback.startsWith("http")) {
                                        buttonDescription.type = "web_url";
                                        buttonDescription.url = postback;
                                    } else {
                                        buttonDescription.type = "postback";
                                        buttonDescription.payload = postback;
                                    }

                                    buttons.push(buttonDescription);
                                }
                            }

                            if (buttons.length > 0) {
                                card.buttons = buttons;
                            }
                        }

                        if (!facebookMessage.attachment) {
                            facebookMessage.attachment = {type: "template"};
                        }

                        if (!facebookMessage.attachment.payload) {
                            facebookMessage.attachment.payload = {template_type: "generic", elements: []};
                        }

                        facebookMessage.attachment.payload.elements.push(card);
                    });

                    facebookMessages.push(facebookMessage);
                }

                    break;
                //message.type 2 means quick replies message
                case 2: {
                    if (message.replies && message.replies.length > 0) {
                        let facebookMessage = {};

                        facebookMessage.text = message.title ? message.title : 'Choose an item';
                        facebookMessage.quick_replies = [];

                        message.replies.forEach((r) => {
                            facebookMessage.quick_replies.push({
                                content_type: "text",
                                title: r,
                                payload: r
                            });
                        });

                        facebookMessages.push(facebookMessage);
                    }
                }

                    break;
                //message.type 3 means image message
                case 3:

                    if (message.imageUrl) {
                        let facebookMessage = {};

                        // "imageUrl": "http://example.com/image.jpg"
                        facebookMessage.attachment = {type: "image"};
                        facebookMessage.attachment.payload = {url: message.imageUrl};

                        facebookMessages.push(facebookMessage);
                    }

                    break;
                //message.type 4 means custom payload message
                case 4:
                    if (message.payload && message.payload.facebook) {
                        facebookMessages.push(message.payload.facebook);
                    }
                    break;

                default:
                    break;
            }
        }

        return new Promise((resolve, reject) => {
            async.eachSeries(facebookMessages, (msg, callback) => {
                    this.sendFBSenderAction(sender, "typing_on")
                        .then(() => this.sleep(this.messagesDelay))
                        .then(() => this.sendFBMessage(sender, msg))
                        .then(() => callback())
                        .catch(callback);
                },
                (err) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else {
                        console.log('Messages sent');
                        resolve();
                    }
                });
        });

    }

    doTextResponse(sender, responseText) {
        console.log('Response as text message');
        // facebook API limit for text length is 640,
        // so we must split message if needed
        let splittedText = this.splitResponse(responseText);

        async.eachSeries(splittedText, (textPart, callback) => {
            this.sendFBMessage(sender, {text: textPart})
                .then(() => callback())
                .catch(err => callback(err));
        });
    }

    //which webhook event
    getEventText(event) {
        if (event.message) {
            if (event.message.quick_reply && event.message.quick_reply.payload) {
                return event.message.quick_reply.payload;
            }

            if (event.message.text) {
                return event.message.text;
            }
        }

        if (event.postback && event.postback.payload) {
            return event.postback.payload;
        }

        return null;

    }

    getFacebookEvent(event) {
        if (event.postback && event.postback.payload) {

            let payload = event.postback.payload;

            switch (payload) {
                case FACEBOOK_WELCOME:
                    return {name: FACEBOOK_WELCOME};

                case FACEBOOK_LOCATION:

                    global.latlang = Object.values(event.postback.data); //setting letlong
                    //console.log('latlong : '+latlang);
                
                    return {name: FACEBOOK_LOCATION, data: event.postback.data}
            }
        }

        return null;
    }

    processFacebookEvent(event) {
        const sender = event.sender.id.toString();
        const eventObject = this.getFacebookEvent(event);       
        
        
        if (eventObject) {
           


            // Handle a text message from this sender
            if (!this.sessionIds.has(sender)) {
                this.sessionIds.set(sender, uuid.v4());
            }

           


                //get user profile details
                request({
                    method: 'GET',
                    uri: `https://graph.facebook.com/v2.12/${sender}?fields=id,name,first_name,last_name,email,birthday,gender&access_token=${FB_PAGE_ACCESS_TOKEN}`
                },
                (error, response, body) => {
                    if (error) {
                        console.error('Error while subscription: ', error);
                    } else {
                        var obj = JSON.parse(response.body);
                        //console.log('First Name: '+ obj.first_name+' & Last Name:'+obj.last_name);
                        //console.log(obj);

                        //entry to DB
                        var docRef = db.collection('users').doc(sender);                   
                   
                        var getDoc = docRef.get()
                        .then(doc => {
                            if (!doc.exists) {
                                console.log('first time user!');
                                var setAda = docRef.set({
                                    name: obj.name,                           
                                    gender:obj.gender,
                                    mobile:'null',
                                    verified:false                          
                                }); 
                            } else {
                                console.log('user already exists');
                            }
                        })
                        .catch(err => {
                            console.log('Error getting document', err);
                        });
                          
                      
                        let apiaiRequest = this.apiAiService.eventRequest(eventObject,
                            {   
                                contexts: [
                                    {
                                      name: "generic",
                                      parameters: {
                                          facebook_user_id: sender,
                                          name : obj.first_name
                                      }
                                    }
                                 ],    
                                sessionId: this.sessionIds.get(sender),
                                originalRequest: {
                                    data: event,
                                    source: "facebook"
                                }
                            });
                            //console.log(apiaiRequest);

                            

                        this.doApiAiRequest(apiaiRequest, sender);
                    }
                });
                //end of user details 
            
                

            
        }
    }

    processMessageEvent(event) {
        const sender = event.sender.id.toString();
        const text = this.getEventText(event);

        if (text) {

            // Handle a text message from this sender
            if (!this.sessionIds.has(sender)) {
                this.sessionIds.set(sender, uuid.v4());
            }

            console.log("Text:", text);
            //send user's text to api.ai service
            let apiaiRequest = this.apiAiService.textRequest(text,
                {
                    sessionId: this.sessionIds.get(sender),
                    originalRequest: {
                        data: event,
                        source: "facebook"
                    }
                });

                //console.log(apiaiRequest);
          

            this.doApiAiRequest(apiaiRequest, sender);
        }
    }

    doApiAiRequest(apiaiRequest, sender) {
        apiaiRequest.on('response', (response) => {

            //console.log(response);          
        

            if (this.isDefined(response.result) && this.isDefined(response.result.fulfillment)) {
                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let responseMessages = response.result.fulfillment.messages;
                
                let act =  response.result.action;

                  //entry to DB
                  var docRef = db.collection('users').doc(sender);
              
                  var getDoc = docRef.get()
                    .then(doc => {
                        if (!doc.exists) {
                            console.log('No such document!');
                        } else {
                            //console.log('Document data:', doc.data());
                            
                            //console.log("Verified : "+doc.data().name);
                            //console.log("Verified : "+doc.data().gender);
                            //console.log("Verified : "+doc.data().mobile);
                            //console.log("Verified : "+doc.data().verified);   
                            const u_name =  doc.data().name;
                            const u_gender = doc.data().gender;
                            const U_mobile = doc.data().mobile;
                            const u_verified = doc.data().verified;                      
                            
                        }
                    })
                    .catch(err => {
                        console.log('Error getting document', err);
                    });

                           
                var otp = Math.floor(1000 + Math.random() * 9000); //random otp 4 digit

                //get proper action
                                                                               
                                           
                    console.log('current  action :'+act);  
                    
                    switch (act) {

                        case 'send_otp':

                        let params1 = response.result.parameters;

                        global.mobile_no = params1.mobile_no;
                        
                        //validate exact 10 digit numeric value
                        //var str='9123456789';
                        //console.log(global.mobile_no+" is 10 digit numeric phone:"+/^\d{10}$/.test(mobile_no));

                     
    
                        var cell_validate = /^\d{10}$/.test(mobile_no); //validate 10 digits
                        console.log(cell_validate+" and "+mobile_no); 

                        if(cell_validate == true){ //valid 10 digit number

                            sendOtp.send("91"+mobile_no, "DrBuny", otp, function (error, data, res) {  
                            
    
                                if(data.type == 'success') console.log('OTP send successfully')
                                if(data.type == 'error') console.log('OTP sending failed')
                          
        
                                console.log("data.type : "+data.type);
                                console.log("data.message : "+data.message);

                                if(data.type == 'success'){ 

                                    //sending back response to user           
                                       let alert_2 = "OTP send successfully";                  
                                           
                                       facebookBot.sendFBMessage(sender, {text: alert_2})
                                       .then(mm => {
                                           
                                           console.log('sent response to user');                     
                                   
                                       })
                                       .catch(err2 => {
                                           console.log('Error sending reply', err2);
                                       }); 

                                    }else{ // wrong mobile number
                                        
                                            //sending back response to user    
                                        let alert_3 = "kindly enter valid mobile number";                  
                                        
                                        facebookBot.sendFBMessage(sender, {text: alert_3})
                                        .then(mmm => {
                                            
                                            console.log('sent response to user');                     
                                    
                                        })
                                        .catch(err3 => {
                                            console.log('Error sending reply', err3);
                                        });  
                                        
                                    }
                               
                                     
                             });

                        }else{

                             //sending back response to user           
                                let alert_1 = "please enter valid 10 digit mobile number";                  
                                    
                                facebookBot.sendFBMessage(sender, {text: alert_1})
                                .then(m => {
                                    
                                    console.log('sent response to user');                     
                            
                                })
                                .catch(err => {
                                    console.log('Error sending reply', err);
                                });   
                        }                           
                  
                                            
           
                        break;
    
                        case 'verify_otp':
    
                        let params2 = response.result.parameters;
    
                        console.log('verify_otp action:'+params2.otp);  
    
                        let v_otp = params2.otp;
    
                        sendOtp.verify("91"+mobile_no, v_otp, function (error, data, res) {
                            console.log(data); // data object with keys 'message' and 'type'
                            if(data.type == 'success') console.log('OTP verified successfully')
                            if(data.type == 'error') console.log('OTP verification failed')

                            if(data.type == 'success'){

                                 //sending back response to user           
                                 let alert_1 = "OTP verified successfully";                  
                                    
                                 facebookBot.sendFBMessage(sender, {text: alert_1})
                                 .then(m => {
                                     
                                     console.log('sent response to user');                     
                             
                                 })
                                 .catch(err => {
                                     console.log('Error sending reply', err);
                                 });  

                                 var updateNested = db.collection('users').doc(sender).update({ // update mobile number & verified as true
                                    verified: true,
                                    mobile: mobile_no

                                });

                            }else{

                                //sending back response to user           
                                let alert_1 = "kindly enter valid OTP";                  
                                    
                                facebookBot.sendFBMessage(sender, {text: alert_1})
                                .then(m => {
                                    
                                    console.log('sent response to user');                     
                            
                                })
                                .catch(err => {
                                    console.log('Error sending reply', err);
                                }); 

                            }
                          });
    
                        
        
    
                        break;
    

                        case 'Call_Ambulance.get_location':

                            let params3 = response.result.parameters;

                            let emergency = params3.emer;

                            console.log("emergency : "+emergency);//user current emergency                          

                            var u_location = "\'"+latlang+"\'"; 
                            console.log("User location : "+u_location); //users current location

                            var arr = latlang.toString().split(",");

                            console.log("lat : "+arr[0]); //user latitude
                            console.log("lng :"+arr[1]); //user longitude



                            var request = require("request");

                            var options = {
                               method: 'GET',
                               url: 'https://maps.googleapis.com/maps/api/geocode/json',
                               qs: { 
                               latlng: ''+arr[0]+','+arr[1]+'', 
                               key: 'AIzaSyAu8KjUwVtY1aLWdlTHgZtzvdejJthiXVs' //google maps API key
                               },
                            };
                             
                            request(options, function(error, response, body) {
                            
                               if (error) throw new Error(error);
                            
                               var jsonArr = JSON.parse(body);
                               var x=jsonArr.results[0].formatted_address;
                            
                               var address = jsonArr.results[0].address_components; //user ambulance request location
                               let zipcode = parseInt(address[address.length - 1].long_name); //request location zip code
                            
                               //console.log(body);
                               console.log("your location : "+x);
                               console.log("your Zip Code : "+zipcode);

                               var ambulanceRef = db.collection('ambulance');
                               
                               let query = db.collection('ambulance').where('live', '==', true).where('area', '==', zipcode); // get ambulances avilable in users location


                               query.get().then(querySnapshot => {

                                                                           

                                        if (querySnapshot.size > 0) {

                                            querySnapshot.forEach(function(documentSnapshot) {

                                               // do get ambulance  data
                                            let ambulance_type = documentSnapshot.data().type;
                                            let ambulance_number = documentSnapshot.data().number;
                                            let ambulance_driver = documentSnapshot.data().driver;
                                           
                                             //entry to DB to get Ambulance driver details
                                             
                                                var driverRef = db.collection('drivers').doc(ambulance_driver);
                                            
                                                var getDriver = driverRef.get()
                                                    .then(doc => {

                                                        if (!doc.exists) {
                                                            console.log('No such document!');
                                                        } else {
                                                           
                                                            let driver_name =  doc.data().name;
                                                            let driver_mobile = doc.data().mobile;
                                                            
                                                            //sending back response to user        waiting to get driver     
                                                            let alert_1 = "Looking for drivers confirmation in your area";                  
                                                                    
                                                            facebookBot.sendFBMessage(sender, {text: alert_1})
                                                            .then(m => {
                                                                
                                                                console.log('sent response to user');                     
                                                        
                                                            })
                                                            .catch(err => {
                                                                console.log('Error sending reply', err);
                                                            }); 


                                                            //calling driver for availabity  check

                                                            client.studio.flows('FWec99649f50681d0bf75b02bbb8b8a8c8').engagements.create({
                                                                to: '+917028164099', from: '+16508352078', 
                                                                parameters: JSON.stringify({name: "Clément"})})
                                                             .then(function(engagement) { 

                                                                console.log('Twilio Engagement :'+engagement.sid); 
                                                                //console.log(JSON.stringify(engagement.context)); 
                                                                //console.log(JSON.stringify(engagement.context.widgets.gather_1.Digits)); 

                                                               //sending back response to user           
                                                               let alert_1 = "Ambulance is dispatched, following are details (1)Ambulance number : "+ambulance_number+", (2)Driver Name : "+driver_name+", (3)Driver Mobile : "+driver_mobile;                  
                                                                    
                                                               facebookBot.sendFBMessage(sender, {text: alert_1})
                                                               .then(m => {
                                                                   
                                                                   console.log('sent response to user');                     
                                                           
                                                               })
                                                               .catch(err => {
                                                                   console.log('Error sending reply', err);
                                                               }); 
                                                             });


                                                              
                                                        }
                                                    })
                                                    .catch(err => {
                                                        console.log('Error getting document driver', err);
                                                    });

                                            });
                                        } else {

                                            console.log('ambulance not avilable');
                                            //sending back response to user           
                                            let alert_1 = "Ambulance is not avilable in your area";                  
                                                                    
                                            facebookBot.sendFBMessage(sender, {text: alert_1})
                                            .then(m => {
                                                
                                                console.log('sent response to user');                     
                                        
                                            })
                                            .catch(err => {
                                                console.log('Error sending reply', err);
                                            }); 

                                        };
                                    })
                                    .catch(function(error) {
                                        console.log("Error getting documents: ", error);
                                    });



                            });


                        break;


                        default:
                       
                        console.log('default action');  
                    }
                
                    
                

                if (this.isDefined(responseData) && this.isDefined(responseData.facebook)) {
                    let facebookResponseData = responseData.facebook;
                    this.doDataResponse(sender, facebookResponseData);
                } else if (this.isDefined(responseMessages) && responseMessages.length > 0) {
                    this.doRichContentResponse(sender, responseMessages);
                }
                else if (this.isDefined(responseText)) {
                    this.doTextResponse(sender, responseText);
                }

            }
        });

        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();
    }

    splitResponse(str) {
        if (str.length <= FB_TEXT_LIMIT) {
            return [str];
        }

        return this.chunkString(str, FB_TEXT_LIMIT);
    }

    chunkString(s, len) {
        let curr = len, prev = 0;

        let output = [];

        while (s[curr]) {
            if (s[curr++] == ' ') {
                output.push(s.substring(prev, curr));
                prev = curr;
                curr += len;
            }
            else {
                let currReverse = curr;
                do {
                    if (s.substring(currReverse - 1, currReverse) == ' ') {
                        output.push(s.substring(prev, currReverse));
                        prev = currReverse;
                        curr = currReverse + len;
                        break;
                    }
                    currReverse--;
                } while (currReverse > prev)
            }
        }
        output.push(s.substr(prev));
        return output;
    }

    sendFBMessage(sender, messageData) {
        return new Promise((resolve, reject) => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {access_token: FB_PAGE_ACCESS_TOKEN},
                method: 'POST',
                json: {
                    recipient: {id: sender},
                    message: messageData
                }
            }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                    reject(error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                    reject(new Error(response.body.error));
                }

                resolve();
            });
        });
    }


    sendFBMessage2(sender, messageData) {
        return new Promise((resolve, reject) => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {access_token: FB_PAGE_ACCESS_TOKEN},
                method: 'POST',
                json: {
                    recipient: {id: sender},
                    message: messageData
                }
            }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                    reject(error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                    reject(new Error(response.body.error));
                }

                resolve();
            });
        });
    }
    
    

    sendFBSenderAction(sender, action) {
        return new Promise((resolve, reject) => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: {access_token: FB_PAGE_ACCESS_TOKEN},
                method: 'POST',
                json: {
                    recipient: {id: sender},
                    sender_action: action
                }
            }, (error, response) => {
                if (error) {
                    console.error('Error sending action: ', error);
                    reject(error);
                } else if (response.body.error) {
                    console.error('Error: ', response.body.error);
                    reject(new Error(response.body.error));
                }

                resolve();
            });
        });
    }

    doSubscribeRequest() {
        request({
                method: 'POST',
                uri: `https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=${FB_PAGE_ACCESS_TOKEN}`
            },
            (error, response, body) => {
                if (error) {
                    console.error('Error while subscription: ', error);
                } else {
                    console.log('Subscription result: ', response.body);
                }
            });
    }

    configureGetStartedEvent() {
        request({
                method: 'POST',
                uri: `https://graph.facebook.com/v2.6/me/thread_settings?access_token=${FB_PAGE_ACCESS_TOKEN}`,
                json: {
                    setting_type: "call_to_actions",
                    thread_state: "new_thread",
                    call_to_actions: [
                        {
                            payload: FACEBOOK_WELCOME
                        }
                    ]
                }
            },
            (error, response, body) => {
                if (error) {
                    console.error('Error while subscription', error);
                } else {
                    console.log('Subscription result', response.body);
                }
            });
    }

    isDefined(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

    sleep(delay) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), delay);
        });
    }

}


let facebookBot = new FacebookBot();

const app = express();

app.use(bodyParser.text({type: 'application/json'}));

app.get('/webhook/', (req, res) => {
    if (req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);

        setTimeout(() => {
            facebookBot.doSubscribeRequest();
        }, 3000);
    } else {
        res.send('Error, wrong validation token');
    }
});

app.post('/webhook/', (req, res) => {
    try {
        const data = JSONbig.parse(req.body);

        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        if (event.message && !event.message.is_echo) {

                            if (event.message.attachments) {
                                let locations = event.message.attachments.filter(a => a.type === "location");

                                // delete all locations from original message
                                event.message.attachments = event.message.attachments.filter(a => a.type !== "location");

                                if (locations.length > 0) {
                                    locations.forEach(l => {
                                        let locationEvent = {
                                            sender: event.sender,
                                            postback: {
                                                payload: "FACEBOOK_LOCATION",
                                                data: l.payload.coordinates
                                            }
                                        };

                                        facebookBot.processFacebookEvent(locationEvent);
                                        //console.log(locationEvent);
                                    });
                                }
                            }

                            facebookBot.processMessageEvent(event);
                        } else if (event.postback && event.postback.payload) {
                            if (event.postback.payload === "FACEBOOK_WELCOME") {
                                facebookBot.processFacebookEvent(event);
                                //console.log(event);
                            } else {
                                facebookBot.processMessageEvent(event);
                            }
                        }
                    });
                }
            });
        }

        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

facebookBot.doSubscribeRequest();
