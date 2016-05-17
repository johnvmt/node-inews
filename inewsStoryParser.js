module.exports = function(nsml, callback) {
	var htmlparser = require("htmlparser");

	var parseHandler = new htmlparser.DefaultHandler(function (error, dom) {
		if (error)
			callback(error, null);
		else
			callback(null, parseNsml(dom));
	});

	var parser = new htmlparser.Parser(parseHandler);
	parser.parseComplete(nsml);

	function parseNsml(nodes, story) {
		if(typeof story === 'undefined') {
			story = {
				fields: {},
				cues: []
			};
		}

		nodes.forEach(function(node) {
			parseNsmlNode(node, story);
		});

		return story;
	}

	function stringifyNodes(nodes) {
		var nodeStr = "";
		if(Array.isArray(nodes)) {
			nodes.forEach(function (node) {
				nodeStr += stringifyNode(node);
			});
		}
		return nodeStr;
	}

	function stringifyNode(node) {
		if(node.type === 'text')
			return node.data;
		else if(node.type === 'tag') {
			var nodeStr = "<" + node.name;
			var attrStr = stringifyAttributes(node.attribs);
			if(attrStr.length > 0)
				nodeStr += " " + attrStr;
			nodeStr += ">";
			nodeStr += stringifyNodes(node.children);
			nodeStr += "</" + node.name + ">";
		}

		return nodeStr;
	}

	function stringifyAttributes(attributes) {
		var attrStr = "";
		for (var key in attributes) {
			if(attrStr.length > 0)
				attrStr += " ";
			attrStr += key + "=\"" + attributes[key].replace(/\"/g,'\\"') + "\"";
		}
		return attrStr;
	}

	function nodesToArray(nodes, tag) {
		var lines = [];

		nodes.forEach(function(node, index) {
			if(node.type === 'tag') {
				if(node.name === tag)
					lines.push(stringifyNodes(node.children));
//				else
					lines = lines.concat(nodesToArray(node.children, tag));
			}
		});

		// Filter out leading lines in production cues
		lines = lines.filter(function(line, index) {
			return line > 0 || line != ']] S3.0 G 0 [[';
		});

		return lines;

	}

	function parseNsmlNode(node, story) {
		if(node.type === 'tag') {
			switch(node.name) {
				case 'ae':
					try {
						var id = node.attribs['id'];
						story.cues[id] = nodesToArray(node.children, 'ap');
					}
					catch(error) {}
					break;
				case 'body':
					story.body = stringifyNodes(node.children);
					break;
				case 'storyid':
					try {
						story.id = node.children[0]['data'];
					}
					catch(error) {}
					break;
				case 'f':
					try {
						var key = node.attribs['id'];
						var val = node.children[0]['data'];
						story.fields[key] = val;
					}
					catch(error) {}
					break;
				default:
					if(Array.isArray(node.children))
						parseNsml(node.children, story);

					break;
			}
		}
	}
};