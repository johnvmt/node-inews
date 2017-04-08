# node-inews #
Connects to an Avid iNews server and allows operations over FTP

## Examples ##

	var Inews = require('inews');

### Connect ###
Will not connect unless a function that requires the connection (eg: cwd, list) is called

	var conn = Inews({
		'host': "inews-hostname",
		'user': "inews-username",
		'password': "inews-password"
	});

### List Files In Directory/Queue ###

	conn.list("YOUR.QUEUE.HERE", function(error, dirList) {
		if(!error) {
			dirList.forEach(function(story) {
				console.log(story.file);
			}
		}
	});
	
### Retrieve all stories in a queue ###

	var inewsQueue = "YOUR.QUEUE.HERE";
	conn.list(inewsQueue, function(error, dirList) {
		if(!error) {
			dirList.forEach(function(storyFile) {
				conn.story(inewsQueue, storyFile.file, function(error, storyDetails) {
    				console.log(error, storyDetails);
    			});
    		}
		}
	});
	
### Retrieve NSML all stories in a queue ###

	var inewsQueue = "YOUR.QUEUE.HERE";
	conn.list(inewsQueue, function(error, dirList) {
		if(!error) {
			dirList.forEach(function(storyFile) {
				conn.storyNsml(inewsQueue, storyFile.file, function(error, storyNsml) {
    				console.log(error, storyNsml);
    			});
    		}
		}
	});