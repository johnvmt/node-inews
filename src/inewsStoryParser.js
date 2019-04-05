import htmlparser from 'htmlparser';
import camelcase from 'camelcase';
import unescape from 'unescape';

export default async (nsml) => {
	return new Promise((resolve, reject) => {
		const parseHandler = new htmlparser.DefaultHandler(function (error, dom) {
			if (error)
				reject(error);
			else
				resolve(parseNsml(dom));
		});

		const parser = new htmlparser.Parser(parseHandler);
		parser.parseComplete(nsml);
	});
}

function parseNsml(nodes, story) {
	if(typeof story === 'undefined') {
		story = {
			fields: {},
			meta: {},
			cues: []
		};
	}

	nodes.forEach(function(node) {
		parseNsmlNode(node, story);
	});

	return story;
}

function stringifyNodes(nodes) {
	let nodeStr = ``;
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
		let nodeStr = `<${node.name}`;
		let attrStr = stringifyAttributes(node.attribs);
		if(attrStr.length > 0)
			nodeStr += ` ${attrStr}`;
		nodeStr += `>${stringifyNodes(node.children)}</${node.name}>`;

		return nodeStr;
	}
}

function stringifyAttributes(attributes) {
	let attrStr = '';
	for(let key in attributes) {
		if(attributes.hasOwnProperty(key)) {
			if(attrStr.length > 0)
				attrStr += " ";
			attrStr += `${key}="${attributes[key].replace(/\"/g,'\\"')}"`;
		}
	}
	return attrStr;
}

function nodesToArray(nodes, tag) {
	let lines = [];

	nodes.forEach(function(node, index) {
		if(node.type === 'tag') {
			if(node.name === tag)
				lines.push(stringifyNodes(node.children));
			lines = lines.concat(nodesToArray(node.children, tag));
		}
	});

	// Filter out leading lines in production cues
	lines = lines.filter(function(line, index) {
		return line > 0 || line !== ']] S3.0 G 0 [[';
	});

	return lines;

}

function parseNsmlNode(node, story) {
	if(node.type === 'tag') {
		switch(node.name) {
			case 'ae':
				try {
					let id = node.attribs['id'];
					story.cues[id] = nodesToArray(node.children, 'ap');
				}
				catch(error) {}
				break;
			case 'body':
				story.body = unescape(stringifyNodes(node.children));
				break;
			case 'meta':
				story.meta = node.attribs;
				break;
			case 'storyid':
				try {
					story.id = node.children[0]['data'];
				}
				catch(error) {}
				break;
			case 'f':
				try {
					let key = node.attribs['id'];
					let val = node.children[0]['data'];
					story.fields[camelcase(key)] = unescape(val);
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
