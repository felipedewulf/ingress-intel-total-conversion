// ==UserScript==
// @id             iitc-plugin-trackowners
// @name           IITC plugin: Track Portal Owners
// @category       Misc
// @version        0.0.1.@@DATETIMEVERSION@@
// @namespace      https://github.com/jonatkins/ingress-intel-total-conversion
// @updateURL      @@UPDATEURL@@
// @downloadURL    @@DOWNLOADURL@@
// @description    [@@BUILDNAME@@-@@BUILDDATE@@] Allow tracking of a region portal ownership. 
// @include        http://www.ingress.com/intel*
// @match          https://www.ingress.com/intel*
// @match          http://www.ingress.com/intel*
// @grant          none
// ==/UserScript==

function wrapper(plugin_info) {
// ensure plugin framework is there, even if iitc is not yet loaded
if(typeof window.plugin !== 'function') window.plugin = function() {};

//PLUGIN AUTHORS: writing a plugin outside of the IITC build environment? if so, delete these lines!!
//(leaving them in place might break the 'About IITC' page or break update checks)
plugin_info.buildName = 'TrackOwners';
plugin_info.dateTimeVersion = '201512087.154202';
plugin_info.pluginId = 'PortalTrackOwners';
//END PLUGIN AUTHORS NOTE

//PLUGIN START ////////////////////////////////////////////////////////


// Create unique plugin namespace
window.plugin.trackowners = function() {};

// Delay syncs for groups of data
window.plugin.trackowners.SYNC_DELAY = 5000;

// Define storage keys for persisting data
window.plugin.trackowners.FIELDS = {
  'trackowners': 'plugin-trackowners-data',
  'updateQueue': 'plugin-trackowners-data-queue',
  'updatingQueue': 'plugin-trackowners-data-updating-queue',
};

//trackowners object:
// key:guid
// Primary:  latE6, lngE6, team, capturedTS, lastSeenTS, precision (SEEN, CAPTURED)
// Secondary: health, level, resocount, title, owner

// Data sets for persisting data
window.plugin.trackowners.trackowners = {};
window.plugin.trackowners.updateQueue = {};
window.plugin.trackowners.updatingQueue = {};
window.plugin.trackowners.indexCoord = {};

// Disable sync intially
window.plugin.trackowners.enableSync = false;

// Display objects
//window.plugin.trackowners.disabledMessage = null;
//window.plugin.trackowners.labelContentHTML = null;
//window.plugin.trackowners.contentHTML = null;

// Disable highlighter until selected
window.plugin.trackowners.isHighlightActive = false;

// Keep track of portal that is being updated.
window.plugin.trackowners.updatingPortalGUID = null;

window.plugin.trackowners.onPortalAddLayer = function(addedPortal) {
  portal=addedPortal.portal;
  if (portal){
    console.log("trackowners: NewPortal Added:"+addedPortal.portal.options.data.title);
    plugin.trackowners.checkSeenPortal(portal);
  } 
}

window.plugin.trackowners.onPortalDetailsUpdated = function(callbackData) {

	console.log("Portal Details Updated:",callbackData);
  // Alert user if there is no storage available
  if(typeof(Storage) === "undefined"){
    $('#portaldetails > .imgpreview').after(plugin.trackowners.disabledMessage);
    return;
  }

	// Imported from portalowner
 // var guid = window.selectedPortal,
  //    details = portalDetail.get(guid),
   //   nickname = window.PLAYER.nickname;

	var guid     = callbackData.guid,
		details  = callbackData.portalDetails,
		seenTS = details.timestamp,
		nickname = window.PLAYER.nickname;


	console.log("Portal Details Updated:"+seenTS,guid,details);


 // Update portal-list data
 // plugin.trackowners.updateChecksAndHighlights(guid);
}


window.plugin.trackowners.onPublicChatDataAvailable = function(data) {
  console.log("Trackowner: Lop new messages");
  data.result.forEach(function(msg) {
    var plext = msg[2].plext,
        markup = plext.markup,
        portal = null,
        guid = null,
		newowner = null,
		msgTS = msg[1];
		
	 if(plext.plextType == 'SYSTEM_BROADCAST'
		  && markup.length==3
      && markup[0][0] == 'PLAYER'
      && markup[1][0] == 'TEXT'
      && markup[1][1].plain == ' captured '
      && markup[2][0] == 'PORTAL') {
        // Player has captured a portal within the bounded area
        portal = markup[2][1];
        newowner = markup[0][1].plain;
		guid = window.findPortalGuidByPositionE6(portal.latE6, portal.lngE6);	
		if (!guid){
			guid = window.plugin.trackowners.getGuidByCoord(portal.latE6, portal.lngE6);
		}
		window.plugin.trackowners.addNewCapturedPortal(guid, newowner,msgTS, portal);
    }	
  });
}
	
window.plugin.trackowners.checkSeenPortal = function(portal) {   // owned, guid, portal, captureTS
	guid = portal.options.guid;
	if(!guid){
		console.log("TrackOwners: Error. checkSeen with invalid guid:"+portal);
		return;
	}
	
	var trackedPortal = plugin.trackowners.trackowners[guid];

	if (trackedPortal){
        if (trackedPortal.latE6!= portal.options.data.latE6 ||
            trackedPortal.lngE6!= portal.options.data.lngE6 ||
            (portal.options.data.title && trackedPortal.title!= portal.options.data.title)){
            console.log("  -- TrackOwners: Updated lat/lng/tilte infos: ",trackedPortal,portal.options);
            trackedPortal.latE6 = portal.options.data.latE6;
            trackedPortal.lngE6 = portal.options.data.lngE6;
            if (portal.options.data.title) {
                trackedPortal.title = portal.options.data.title;
            }
            plugin.trackowners.pushGuidByCoord(guid, trackedPortal.latE6, trackedPortal.lngE6);
            plugin.trackowners.sync(guid);
        }
		//console.log("TrackOwners: Portal Already Seen:",trackedPortal);
		if (trackedPortal.team==portal.options.data.team){
			// Still the same team
			if ((portal.options.timestamp>0)){ // and not a fake portal
				if (portal.options.timestamp<trackedPortal.capturedTS && trackedPortal.type=="SEEN"){
					trackedPortal.capturedTS = portal.options.timestamp;
					console.log("  -- TrackOwners: Updated inicial Seen time:",trackedPortal);
					plugin.trackowners.sync(guid);

				}else if(portal.options.timestamp>trackedPortal.seenTS){
					trackedPortal.seenTS = portal.options.timestamp;
					trackedPortal.health = portal.options.data.health;
					trackedPortal.level  = portal.options.data.level;
					console.log("  -- TrackOwners: Updated final Seen time:",trackedPortal);					
					plugin.trackowners.sync(guid);
				}
			}
		}else{  // Portal changed ownership
			console.log("TrackOwners: Portal Changed Ownership",trackedPortal,portal.options);
			// Portal with timestamp - (fakeportal), or old timestamp, is ignored.
			// TODO consider fakeportals to reset Capture date and team. But with wich timestamp?
			if (portal.options.timestamp>trackedPortal.capturedTS && portal.options.timestamp<=trackedPortal.seenTS){
				// Portal was seen as a new team after tracked capture, but before last SEEN date. 
				// So, consider last SEEN date as new Capture.
				trackedPortal.capturedTS = trackedPortal.seenTS;
				trackedPortal.type = "SEEN";
				console.log("  -- TrackOwners: Portal changed between Capture and last Seen:",trackedPortal);					
			}else if (portal.options.timestamp>trackedPortal.seenTS) {
				// Portal was seen recently with new team.
				console.log("  -- TrackOwners: Overwriting portal seen:",portal);
				plugin.trackowners.addNewSeenPortal(guid,portal);				
			}
		}
	}else{
		if (portal.options.timestamp>0){
			console.log("Adding new portal seen:",portal);
			plugin.trackowners.addNewSeenPortal(guid,portal);
		}else{
			// console.log("TrackOwner: Ignoring fake Portal "+guid);
		}
	}
}	
	
// Primary:  latE6, lngE6, team, capturedTS, lastSeenTS, precision (SEEN, CAPTURED)
// Secondary: health, level, resocount, title, owner

window.plugin.trackowners.addNewCapturedPortal = function(guid, newowner,newCapTS, portal) {
	if(!guid){
		console.log("TrackOwners: Error. addNewCapcturedPortal with invalid guid:",portal);
		return;
	}

	var trackedPortal = plugin.trackowners.trackowners[guid];

	if (trackedPortal){
 		var newCapTeam="-";
		if (portal.team && portal.team.length>1 ){
			newCapTeam=portal.team.charAt(0);
		}
		if (newCapTeam!="E" && newCapTeam!="R"){
			console.log("TrackOwners: Error. addNewCapcturedPortal invalid Team:",portal);
			return;
		}

		// If portal Captured after last seenTS, (seenTS < newCapTS), define new Capture
		// Else if portal Captured after last capturedTS ( capturedTS < newCapTS) :
		//			and on the same team, update capturedTS <- newCapTS
		//          else (other team), set as SEEN, and capturedTS <- seenTS
		// Else (newCapTS < capTS) and SEEN and on the same team, capturedTS <- newCapTS
		//  TODO Check to update Lat/Lng and Title ?
		if ((trackedPortal.seenTS < newCapTS)||(trackedPortal.seenTS == newCapTS && trackedPortal.type=="SEEN")){
			console.log("TrackOwners: New Portal Captured by:"+newowner,portal);
			trackedPortal.seenTS= newCapTS;
			trackedPortal.capturedTS = newCapTS;
			trackedPortal.team=newCapTeam;
			trackedPortal.type="CAPTURED";
			trackedPortal.owner=newowner;
			trackedPortal.health=null;
			trackedPortal.level=null;
			plugin.trackowners.sync(guid);
		}else if ((trackedPortal.capturedTS < newCapTS )||(trackedPortal.capturedTS == newCapTS && trackedPortal.type=="SEEN")){
			if (trackedPortal.team==newCapTeam){
				console.log("TrackOwners: Portal Already Seen. updated Captured by:"+newowner,portal, trackedPortal);
				trackedPortal.capturedTS = newCapTS;
				trackedPortal.type="CAPTURED";
				trackedPortal.owner=newowner;
				plugin.trackowners.sync(guid);
			}else{
				console.log("TrackOwners: New Portal Already Seen. But Captured inbetween by:"+newowner,portal, trackedPortal);
				trackedPortal.capturedTS = trackedPortal.seenTS;
				trackedPortal.team=newCapTeam;
				trackedPortal.type="SEEN";
				trackedPortal.owner=null;
				trackedPortal.health=null;
				trackedPortal.level=null;
				plugin.trackowners.sync(guid);
			}
		}else{
			if (trackedPortal.type=="SEEN" && trackedPortal.team==newCapTeam){
				console.log("TrackOwners: New Portal Captured when was alrady Seen.:"+newowner,portal, trackedPortal);
				trackedPortal.capturedTS = newCapTS;
				trackedPortal.type="CAPTURED";
				trackedPortal.owner=newowner;
				plugin.trackowners.sync(guid);
			}
		}

	}else{
		console.log("TrackOwners: Error. addNewCapcturedPortal couldnt find guid portal:"+guid+" of "+portal);
	}
}

window.plugin.trackowners.addNewSeenPortal = function(guid, portal){
	var newPortal = {
		seenTS: portal.options.timestamp,
		capturedTS: portal.options.timestamp,
        team: portal.options.data.team,
		title: portal.options.data.title,
		type: "SEEN",
		health: portal.options.data.health,
		level: portal.options.data.level,
		latE6: portal.options.data.latE6,
		lngE6: portal.options.data.lngE6
      };
	  plugin.trackowners.pushGuidByCoord(guid, newPortal.latE6, newPortal.lngE6);
	  plugin.trackowners.trackowners[guid]=newPortal;
	  plugin.trackowners.sync(guid);
}
// --------------------------  Index by LatLong

window.plugin.trackowners.pushGuidByCoord = function(guid, latE6, lngE6) {
	// TODO DEBUG check lat e long for not invalid
    plugin.trackowners.indexCoord[latE6+","+lngE6] = guid;
	console.log("adding "+guid+" -> "+latE6+","+lngE6);
	console.log("TrackOwners Loaded tracked portals:"+Object.keys(plugin.trackowners.indexCoord).length);

}
  
window.plugin.trackowners.getGuidByCoord = function(latE6, lngE6) {
    return plugin.trackowners.indexCoord[latE6+","+lngE6];
}


// --------------------------  Persistence functions

// stores the gived GUID for sync
window.plugin.trackowners.sync = function(guid) {
	var  start = performance.now();
  plugin.trackowners.updatingQueue[guid] = true;
  plugin.trackowners.storeLocal('trackowners');
  plugin.trackowners.storeLocal('updateQueue');
  console.log("Time spent in sync:"+(performance.now()-start));
 // plugin.trackowners.syncQueue();
}

window.plugin.trackowners.storeLocal = function(name) {
  var key = window.plugin.trackowners.FIELDS[name];
  if(key === undefined)
    return;

  var value = plugin.trackowners[name];

  if(typeof value !== 'undefined' && value !== null)
    localStorage[key] = JSON.stringify(plugin.trackowners[name]);
  else
    localStorage.removeItem(key);
}

window.plugin.trackowners.loadLocal = function(name) {
  var key = window.plugin.trackowners.FIELDS[name];
  if(key === undefined)
    return;

  if(localStorage[key] !== undefined){
    plugin.trackowners[name] = JSON.parse(localStorage[key]);
	var vetx = plugin.trackowners[name];
	console.log("TrackOwners Loaded tracked portals:"+Object.keys(vetx).length);
	Object.keys(vetx).forEach(function (guid) {
		var portal = vetx[guid];
		plugin.trackowners.pushGuidByCoord(guid, portal.latE6, portal.lngE6);
	});
 
  }
}

// --------------------------  Portal List Columns

window.plugin.trackowners.daysOwnedByGUID = function(guid) {
  var portalInfo = window.plugin.trackowners.trackowners[guid];
  if(portalInfo)
    return window.plugin.trackowners.daysOwnedByPortal(portalInfo);
  return 0;
}

window.plugin.trackowners.daysOwnedByPortal = function(portal) {
  if(portal && portal.capturedTS)
    return Math.floor((Date.now() - portal.capturedTS) / 86400000);
  return 0;
}

window.plugin.trackowners.TS2Date = function(timestamp){
	var d = new Date(timestamp);
	var curr_hour = d.getHours();
    var curr_min = d.getMinutes();

	var curr_date = d.getDate();
	var curr_month = d.getMonth()+1;
	var curr_year = d.getFullYear();
	return curr_hour +":"+curr_min+" "+curr_date + "/" + curr_month + "/" + curr_year;
}

window.plugin.trackowners.setupPortalsList = function() {
  if(!window.plugin.portalslist)
    return;

 var trackownersPortalOwner = {
		title: "Owner",
		value: function(portal) { 
			var uName = "";
			var pInfo =  plugin.trackowners.trackowners[portal.options.guid];
			if (pInfo && pInfo.owner) uName = pInfo.owner;
			return uName; 
		}, 
		sortValue: function(value, portal) { return value.toLowerCase(); },
		format: function(cell, portal, value) {
		  $(cell)
			.text(value);
		},
    }
var trackownersPortalOwnershipTime = {
		title: "Days Owned",
		value: function(portal) { return window.plugin.trackowners.daysOwnedByGUID(portal.options.guid)},
		format: function(cell, portal, value) {
		  var pInfo =  plugin.trackowners.trackowners[portal.options.guid];
		  var printValue = value;
		  var helpMsg = "";
		  if (pInfo){
			  if (pInfo.type=="SEEN") printValue = printValue+" +";
			  helpMsg = plugin.trackowners.TS2Date(pInfo.capturedTS);
		  }
		  $(cell)
			.addClass('help')
			.attr('title', helpMsg)
			.text(printValue);
		},
    }
	window.plugin.portalslist.fields.push(trackownersPortalOwnershipTime);
	window.plugin.portalslist.fields.push(trackownersPortalOwner);
}

// --------------------------  Prepare Content

window.plugin.trackowners.setupContent = function() {
//  plugin.trackowners.labelContentHTML = '<label><input type="checkbox" id="owned" onclick="window.plugin.trackowners.updateOwned($(this).prop(\'checked\'))"> Owner</label>';

//  plugin.trackowners.contentHTML = '<div id="trackowners-container">'
//    + plugin.trackowners.labelContentHTML
//    + '</div>';
  plugin.trackowners.disabledMessage = '<div id="trackowners-container" class="help" title="Your browser does not support localStorage">Trackowners plugin disabled</div>';
}


// SETUP FUNCTION

var setup = function() {

 // window.plugin.trackowners.setupCSS();
  window.plugin.trackowners.setupContent();
  window.plugin.trackowners.loadLocal('trackowners');
  
  window.addHook('portalAdded', window.plugin.trackowners.onPortalAddLayer);
  window.addHook('portalDetailsUpdated', window.plugin.trackowners.onPortalDetailsUpdated);
  window.addHook('publicChatDataAvailable', window.plugin.trackowners.onPublicChatDataAvailable);
 // window.addHook('iitcLoaded', window.plugin.trackowners.registerFieldForSyncing);

  if(window.plugin.portalslist)
    window.plugin.trackowners.setupPortalsList();
  else {
    setTimeout(function() {
      if(window.plugin.portalslist)
        window.plugin.trackowners.setupPortalsList();
    }, 1000);
  }
  
}

//PLUGIN END //////////////////////////////////////////////////////////



setup.info = plugin_info; //add the script info data to the function as a property
if(!window.bootPlugins) window.bootPlugins = [];
window.bootPlugins.push(setup);
// if IITC has already booted, immediately run the 'setup' function
if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);





