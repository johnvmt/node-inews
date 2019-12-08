# node-inews
Retrieve queue listings and stories from Avid iNews Servers over FTP

## Options

Option|Description|Default
-----|-----|-----
host|iNews FTP server| 
hosts|Array of iNews FTP servers| 
maxConnections|Maximum number of conenctions to open|1
minConnections|Minimum number of connections to keep open|0
connectionIdleTimeout|Time to keep connection open after it has no requests pending (milliseconds)|60,000 (1 minute)
optimalConnectionJobs|Soft max on number of requests pending on a connection before opening a new connection|25
rotateHosts|Cycle through servers when creating multiple connections|TRUE
user|iNews FTP username| 
password|iNews FTP password| 

## Examples

	const Inews = require('inews')

	import Inews from 'inews';
	

### Connect
Will not connect unless a function that requires the connection (eg: cwd, list) is called

	const conn = new Inews({
		host: "inews-hostname",
		user: "inews-username",
		password: "inews-password"
	});
	
Connect with backup servers and up to 10 connections

	const conn = new Inews({
		hosts: ["inews-hostname-a", "inews-hostname-b", "inews-hostname-c"],
		user: "inews-username",
		password: "inews-password",
		maxConnections: 10,
		minConnections: 1,
		optimalConnectionJobs: 25,
		rotateHosts: true,
		connectionIdleTimeout: 60000
	});
	
	

### List Files In Directory/Queue ###

	conn.list("YOUR.QUEUE.HERE")
		.then((dirList) => {
			dirList.forEach((story) => {
        		console.log(story.fileName);
        	})
		})
		.catch((error) => {
			console.error(error);
		});
	
### Retrieve all stories in a queue

	let inewsQueue = "YOUR.QUEUE.HERE";

	conn.list(inewsQueue)
	    .then(listItems => {
	        listItems.forEach((listItem) => {
        		if(listItem.fileType === 'STORY') {
        			conn.story(inewsQueue, listItem.fileName)
        			    .then(story => {
        					console.log("STORY", story);
        				})
        				.catch(error => {
        					console.error("ERROR", error);
        				});
        		}
        	});
	    });

	
### Retrieve NSML of all stories in a queue

	let inewsQueue = "YOUR.QUEUE.HERE";
    
    	conn.list(inewsQueue)
    	    .then(listItems => {
    	        listItems.forEach((listItem) => {
            		if(listItem.fileType === 'STORY') {
            			conn.storyNsml(inewsQueue, listItem.fileName)
            			    .then(story => {
            					console.log("STORY", story);
            				})
            				.catch(error => {
            					console.error("ERROR", error);
            				});
            		}
            	});
    	    });

### Get all stories that can be retrieved in 10 seconds

    let storyPromises = new Set();

	let inewsQueue = "YOUR.QUEUE.HERE";

	conn.list(inewsQueue)
        .then(listItems => {
            listItems.forEach((listItem) => {
                if(listItem.fileType === 'STORY') {
                    let storyPromise = conn.story(inewsQueue, listItem.fileName);

                    storyPromises.add(storyPromise);

                    storyPromise
                        .then(story => {
                            console.log("STORY", story);
                        })
                        .catch(error => {
                            console.error("ERROR", error);
                        })
                        .finally(() => {
                            promises.delete(storyPromise);
                        });
                }
            });
        });

    setTimeout(() => {
        storyPromises.forEach(storyPromise => {
            storyPromise.cancel();
        })
    }, 10000);

### Monitor number of requests and number of conenctions
	
	let inewsQueue = "YOUR.QUEUE.HERE";
    
    conn.on('connections', connections => {
        console.log(connections + ' connections active');
    });
    
    conn.on('requests', requests => {
        console.log(requests + ' total requests');
    });
    
    conn.on('queued', queued => {
        console.log(queued + ' queued requests');
    });
        
    conn.on('running', running => {
        console.log(running + ' running requests');
    });
    
    conn.on('error', error => {
        console.log('Error', error);
    });
    
    conn.list(inewsQueue)
        .then(listItems => {
            listItems.forEach((listItem) => {
                if(listItem.fileType === 'STORY') {
                    conn.story(inewsQueue, listItem.fileName)
                        .then(story => {
                            console.log("STORY", story);
                        })
                        .catch(error => {
                            console.error("ERROR", error);
                        });
                }
            });
        });
	
### Changes

#### v3.0.1

- Bugfix to ESM export

#### v3.0.0

- Multiple connections enabled
- Includes attachments in stories

#### v2.0.1

- cwd_failed error now a proper Error, not a string

#### v2.0.0

- Adds cancelable promises
