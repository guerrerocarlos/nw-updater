node-webkit updater module
=======================================================

Automatically (and silently) updates node-webkit apps on the background

## How it works?

This code will contact the update API endpoint and if a new version is available, will download and install it.

    var gui = require('nw.gui');
    var currentVersion = gui.App.manifest.version

    var updater = require('nw-updater')({'channel':'beta', "currentVersion": currentVersion,'endpoint':'http://torrentv.github.io/update.json'})
    updater.update()

    updater.on("download", function(version){
        console.log("OH YEAH! going to download version "+version)
    })

    updater.on("installed", function(){
        console.log("SUCCCESSFULLY installed, please restart")
    })

For an example update.json please visit: [http://torrentv.github.io/update.json](http://torrentv.github.io/update.json)

## Installation 

With [npm](http://npmjs.org):

[![NPM](https://nodei.co/npm/nw-updater.png?downloads=true)](https://nodei.co/npm/nw-updater/)

## Executable creation

It is designed to work with builds generated with [grunt-node-webkit-builder-for-nw-updater](https://github.com/guerrerocarlos/grunt-node-webkit-builder-for-nw-updater) 

[![NPM](https://nodei.co/npm/grunt-node-webkit-builder-for-nw-updater.png?downloads=true)](https://nodei.co/npm/grunt-node-webkit-builder-for-nw-updater/)

## Update.json:

update.json checksums and signatures can be created using [node-sign-release](http://npmjs.org/package/node-sign-release)

## Kudos

Kudos for the original authors of this module, the [PopcornTime.io](http://popcorntime.io/) developers.
