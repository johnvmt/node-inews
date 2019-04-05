# node-inews #
Connects to an Avid iNews server and allows operations over FTP

## Examples ##

	const Inews = require('inews')


	import Inews from 'inews';
	

### Connect ###
Will not connect unless a function that requires the connection (eg: cwd, list) is called

	const conn = new Inews({
		'host': "inews-hostname",
		'user': "inews-username",
		'password': "inews-password"
	});
	
Connect with backup servers

	const conn = new Inews({
		'hosts': ["inews-hostname-a", "inews-hostname-b", "inews-hostname-c"],
		'user': "inews-username",
		'password': "inews-password"
	});

### List Files In Directory/Queue ###

	conn.list("YOUR.QUEUE.HERE")
		.then((dirList) => {
			dirList.forEach((story) => {
        		console.log(story.file);
        	}
		})
		.catch((error) => {
			console.error(error);
		});
	
### Retrieve all stories in a queue ###

	let inewsQueue = "YOUR.QUEUE.HERE";

	conn.list(inewsQueue)
	    .then(listItems => {
	        listItems.forEach((listItem) => {
        		if(listItem.filetype === 'file') {
        			conn.story(inewsQueue, listItem.file)
        			    .then(story => {
        					console.log("STORY", story);
        				})
        				.catch(error => {
        					console.error("ERROR", error);
        				});
        		}
        	});
	    });

	
### Retrieve NSML all stories in a queue ###

	let inewsQueue = "YOUR.QUEUE.HERE";
    
    	conn.list(inewsQueue)
    	    .then(listItems => {
    	        listItems.forEach((listItem) => {
            		if(listItem.filetype === 'file') {
            			conn.storyNsml(inewsQueue, listItem.file)
            			    .then(story => {
            					console.log("STORY", story);
            				})
            				.catch(error => {
            					console.error("ERROR", error);
            				});
            		}
            	});
    	    });

### Get all stories that cna be retrieved in 10 seconds ###

    let storyPromises = new Set();

	let inewsQueue = "YOUR.QUEUE.HERE";

	conn.list(inewsQueue)
        .then(listItems => {
            listItems.forEach((listItem) => {
                if(listItem.filetype === 'file') {
                    let storyPromise = conn.story(inewsQueue, listItem.file);

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
	
### Changes

#### v2.0.0

- Adds cancelable promises
