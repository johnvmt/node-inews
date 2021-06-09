import htmlparser2 from "htmlparser2";

export default (nsml) => {
    const rootNodes = [];
    const nodeStack = [];
    let currentNode;

    const parser = new htmlparser2.Parser(
        {
            onopentag(name, attributes) {
                currentNode = {
                    type: 'tag',
                    name: name,
                    attributes: attributes,
                    children: []
                };

                if(nodeStack.length === 0)
                    rootNodes.push(currentNode);
                else {
                    let lastStackElem = nodeStack[nodeStack.length - 1];
                    lastStackElem.children.push(currentNode);
                }

                nodeStack.push(currentNode);
            },
            ontext(text) {
                if(text.trim().length)
                    currentNode.children.push({
                        type: 'text',
                        text: text
                    });
            },
            onclosetag(tagname) {
                nodeStack.pop();
            }
        },
        { decodeEntities: true, xmlMode: true }
    );

    parser.write(nsml);
    parser.end();
    return rootNodes;
}