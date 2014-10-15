node-webkit updater module
=======================================================

Automatically (and silently) updates node-webkit apps on the background

## How it works?

This code will contact the update API endpoint and if a new version is available, will download and install it.

    var gui = require('nw.gui');
    var currentVersion = gui.App.manifest.version

    var updaterConfig = {
        'channel':'beta',
        'currentVersion': currentVersion
        'endpoint':'http://torrentv.github.io/update.json'
    }

    var updater = require(updaterConfig)
    updater.update()

    updater.on("download", function(version){
        console.log("OH YEAH! going to download version "+version)
    })

    updater.on("installed", function(){
        console.log("SUCCCESSFULLY installed, please restart")
    })


## Installation 

With [npm](http://npmjs.org):

    npm install nw-update

## Update.json:

update.json checksums and signatures can be created using [node-sign-release](http://npmjs.org/packages/node-sign-release)

## Kudos

Kudos for the original authors of this module, that was taken from update.js file in [PopcornTime.io](http://popcorntime.io/)
