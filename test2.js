var listItem = "---------- 1 1   180 Feb 10 16:09  0DDA5043:00F76BB3:589E2C15 04-";

var pattern = /([^\s]+)/i;
var flagParts = listItem.match(pattern);

if(flagParts[0][1] == 'f')
	console.log("FLOATED");

/*
LITEM ---------- 1 1     0 Feb 10 14:41  03DA56DA:00BD8B6C:589E1776
LITEM2 ---------- 1 1     0 Feb 10 14:41  03DA56DA:00BD8B6C:589E1776
*/

