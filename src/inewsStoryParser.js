import camelcase from "camelcase";
import unescape from "unescape";
import xmlToJSON from "./xmlToJSON.js";

export default async (nsml) => {
	let story = {
		fields: {},
		meta: {},
		cues: [],
		attachments: {}
	};

	const nsmlNodes = xmlToJSON(nsml);
	traverseNodes(nsmlNodes);
	return story;

	function traverseNodes(nodes) {
		for(let node of nodes) {
			switch(node.name) {
				case 'wgroup':
					story.wgroup = node.attributes.number;
					break;
				case 'rgroup':
					story.rgroup = node.attributes.number;
					break;
				case 'ae':
					try {
						let id = node.attributes['id'];
						story.cues[id] = nodesToArray(node.children, 'ap');
					}
					catch(error) {}
					break;
				case 'body':
					story.body = unescape(stringifyNodes(node.children));
					break;
				case 'meta':
					story.meta = node.attributes;
					traverseNodes(node.children);
					break;
				case 'storyid':
					try {
						story.id = unescape(stringifyNodes(node.children));
					}
					catch(error) {}
					break;
				case 'formname':
					try {
						story.formname = unescape(stringifyNodes(node.children));
					}
					catch(error) {}
					break;
				case 'f':
					try {
						story.fields[camelcase(node.attributes['id'])] = unescape(stringifyNodes(node.children));
					}
					catch(error) {
					}
					break;
				case 'attachment':
					try {
						story.attachments[camelcase(node.attributes['id'])] = unescape(stringifyNodes(node.children));
					}
					catch(error) {}
					break;
				default:
					if(node.type === 'tag')
						traverseNodes(node.children);
			}
		}
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

		return lines;
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
		switch(node.type) {
			case 'tag':
				let nodeStr = `<${node.name}`;
				let attrStr = stringifyAttributes(node.attributes);
				if(attrStr.length > 0)
					nodeStr += ` ${attrStr}`;
				nodeStr += `>${stringifyNodes(node.children)}</${node.name}>`;
				return nodeStr;
			case 'text':
				return node.text;
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
}

