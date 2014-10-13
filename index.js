'use strict';

var request = require('request'),
    semver = require('semver'),
    fs = require('fs'),
    url = require('url'),
    Q = require('q'),
    _ = require('underscore'),
    rm = require('rimraf'),
    path = require('path'),
    crypto = require('crypto'),
    zip = require('adm-zip'),
    spawn = require('child_process').spawn,
    torrentStream = require('torrent-stream');

;

var UPDATE_ENDPOINT = require('./updater-settings').updateApiEndpoint,
    CHANNELS = ['stable', 'beta', 'nightly'],
    FILENAME = 'package.nw.new',
    VERIFY_PUBKEY =
        '-----BEGIN PUBLIC KEY-----\n' +
        'MIIBtjCCASsGByqGSM44BAEwggEeAoGBAPNM5SX+yR8MJNrX9uCQIiy0t3IsyNHs\n' +
        'HWA180wDDd3S+DzQgIzDXBqlYVmcovclX+1wafshVDw3xFTJGuKuva7JS3yKnjds\n' +
        'NXbvM9CrJ2Jngfd0yQPmSh41qmJXHHSwZfPZBxQnspKjbcC5qypM5DqX9oDSJm2l\n' +
        'fM/weiUGnIf7AhUAgokTdF7G0USfpkUUOaBOmzx2RRkCgYAyy5WJDESLoU8vHbQc\n' +
        'rAMnPZrImUwjFD6Pa3CxhkZrulsAOUb/gmc7B0K9I6p+UlJoAvVPXOBMVG/MYeBJ\n' +
        '19/BH5UNeI1sGT5/Kg2k2rHVpuqzcvlS/qctIENgCNMo49l3LrkHbJPXKJ6bf+T2\n' +
        '8lFWRP2kVlrx/cHdqSi6aHoGTAOBhAACgYBTNeXBHbWDOxzSJcD6q4UDGTnHaHHP\n' +
        'JgeCrPkH6GBa9azUsZ+3MA98b46yhWO2QuRwmFQwPiME+Brim3tHlSuXbL1e5qKf\n' +
        'GOm3OxA3zKXG4cjy6TyEKajYlT45Q+tgt1L1HuGAJjWFRSA0PP9ctC6nH+2N3HmW\n' +
        'RTcms0CPio56gg==\n' +
        '-----END PUBLIC KEY-----\n';


function forcedBind(func, thisVar) {
    return function() {
        return func.apply(thisVar, arguments);
    };
}

function Updater(options) {
    if(!(this instanceof Updater)) {
        return new Updater(options);
    }

    var self = this;
    //module.exports = self

    this.options = _.defaults(options || {}, {
        endpoint: UPDATE_ENDPOINT,
        channel: 'beta'
    });

    var os = ""
    switch (process.platform) {
        case 'darwin':
            os = 'mac'
            break;
        case 'win32':
            os = 'windows'
            break;
        case 'linux':
            os = 'linux'
            break;
        default:
            os = 'unknown'
            break;
    }
    this.os = os

    if (/64/.test(process.arch)) {
        this.arch = 'x64';
    } else {
        this.arch = 'x86';
    }

    this.currentVersion = options.currentVersion
    console.log(this.currentVersion)


    this.outputDir = this.os === 'linux' ? process.execPath : process.cwd();
    this.updateData = null;

    this.check = this.check.bind(this)
    this.download = this.download.bind(this)
}

Updater.prototype.check = function() {
    console.log("checking if update available")
    var defer = Q.defer();
    var promise = defer.promise;
    var self = this;

    if(!(!_.contains(fs.readdirSync('.'), '.git') || // Test Development
        (   // Test Windows
            this.os === 'windows' &&
            process.cwd().indexOf(process.env.APPDATA) !== -1
        ) ||
        (   // Test Linux
            this.os === 'linux' &&
            _.contains(fs.readdirSync('.'), 'package.nw')
        ) ||
        (   // Test Mac OS X
            this.os === 'mac' &&
            process.cwd().indexOf('Resources/app.nw') !== -1
        ))
    ) {
        console.log('Not updating because we are running in a development environment');
        defer.resolve(false);
        return defer.promise;
    }

    console.log("sending request "+this.os)
    request(this.options.endpoint, {json:true}, function(err, res, data) {

        console.log("request sent")
        console.log(self)

        if(err || !data) {
            defer.reject(err);
        } else {
            defer.resolve({"data": data, "os":self.os, "arch": this.arch, "this": self});
        }
        console.log("sending sent")
    });

    return promise.then(function(data) {
        console.log("aja")
        var self = data["this"]
        console.log(self)
        /*
        if(!_.contains(Object.keys(data), this.os)) {
            // No update for this OS, FreeBSD or SunOS.
            // Must not be an official binary
            console.log("something wrong happened...")
            return false;
        }
        */

        console.log("pueh")
        console.log(data["os"])
        console.log("pueh2")
        var updateData = data["data"][data["os"]];
        console.log(updateData)
        console.log("pueh3")
        console.log(data["os"])
        if(data["os"] == 'linux') {
            console.log("entering here")
            updateData = updateData[self.arch];
        }

        // Normalize the version number
        if(!updateData.version.match(/-\d+$/)) {
            console.log("fixing UpdateData")
            updateData.version += '-0';
        }
        console.log(updateData.version)
        console.log(self.currentVersion)
        if(!self.currentVersion.match(/-\d+$/)) {
            console.log("fixing thisCurrentVersion")
            self.currentVersion += '-0';
        }
        console.log(self.currentVersion)
        console.log("pueh4")
        //var self = data["this"]

        if(semver.gt(updateData.version, self.currentVersion)) {
            console.log('Updating to version %s', updateData.version);
            self.updateData = updateData;
            return true;
        }
        console.log("not updating :()")

        console.log(">>> "+self.updateData)

        console.log("latest version!")
        console.log('Not updating because we are running the latest version');
        return false;

    });
};

Updater.prototype._download = function (downloadStream, output, defer) {
    console.log("this is serious, going to download this new version")
    downloadStream.pipe(fs.createWriteStream(output));
    downloadStream.on('complete', function() {
        console.log("OMG this thing completed!")
        defer.resolve(output);
    });
};

Updater.prototype.download = function(source, output) {
    console.log(source)
    console.log(output)
    var defer = Q.defer();
    var self = this;
    console.log("everything good so far")
    switch (url.parse(source).protocol) {
    case 'magnet:':
        var engine = torrentStream(source);
        engine.on('ready', function() {
            var file = engine.files.pop();
            console.log('filename:', file.name);
            self._download(file.createReadStream(), output, defer);
        });
        break;
    case 'http:':
    case 'https:':
        console.log("seems legit")
        self._download(request(source), output, defer);
        break;
    }
    return defer.promise;
};

Updater.prototype.verify = function(source) {
    var defer = Q.defer();
    var self = this;

    var hash = crypto.createHash('SHA1'),
        verify = crypto.createVerify('DSA-SHA1');

    var readStream = fs.createReadStream(source);
    readStream.pipe(hash);
    readStream.pipe(verify);
    readStream.on('end', function() {
        hash.end();
        if(
            self.updateData.checksum !== hash.read().toString('hex') ||
            verify.verify(VERIFY_PUBKEY, self.updateData.signature, 'base64') === false
        ) {
            defer.reject('invalid hash or signature');
        } else {
            defer.resolve(source);
        }
    });
    return defer.promise;
};

function installWindows(downloadPath, updateData) {
    var outputDir = path.dirname(downloadPath),
        installDir = path.join(outputDir, 'app');
    var defer = Q.defer();

    var pack = new zip(downloadPath);
    pack.extractAllToAsync(installDir, true, function(err) {
        if(err) {
            defer.reject(err);
        } else {
            fs.unlink(downloadPath, function(err) {
                if(err) {
                    defer.reject(err);
                } else {
                    defer.resolve();
                }
            });
        }
    });

    return defer.promise;
}

function installLinux(downloadPath, updateData) {
    var outputDir = path.dirname(downloadPath),
        packageFile = path.join(outputDir, 'package.nw');
    var defer = Q.defer();

    fs.rename(packageFile, path.join(outputDir, 'package.nw.old'), function(err) {
        if(err) {
            defer.reject(err);
        } else {
            fs.rename(downloadPath, packageFile, function(err) {
                if(err) {
                    // Sheeet! We got a booboo :'(
                    // Quick! Lets erase it before anyone realizes!
                    if(fs.existsSync(downloadPath)) {
                        fs.unlink(downloadPath, function(err) {
                            if(err) {
                                defer.reject(err);
                            } else {
                                fs.rename(path.join(outputDir, 'package.nw.old'), packageFile, function(err) {
                                    // err is either an error or undefined, so its fine not to check!
                                    defer.reject(err);
                                });
                            }
                        });
                    } else {
                        defer.reject(err);
                    }
                } else {
                    fs.unlink(path.join(outputDir, 'package.nw.old'), function(err) {
                        if(err) {
                            // This is a non-fatal error, should we reject?
                            defer.reject(err);
                        } else {
                            defer.resolve();
                        }
                    });
                }
            });
        }
    });

    return defer.promise;
}

function installOSX(downloadPath, updateData) {
    var outputDir = path.dirname(downloadPath),
        installDir = path.join(outputDir, 'app.nw');
    var defer = Q.defer();

    if(true==false){
    rm(installDir, function(err) {
        if(err) {
            defer.reject(err);
        } else {
            var pack = new zip(downloadPath);
            pack.extractAllToAsync(installDir, true, function(err) {
                if(err) {
                    defer.reject(err);
                } else {
                    fs.unlink(downloadPath, function(err) {
                        if(err) {
                            defer.reject(err);
                        } else {
                            defer.resolve();
                        }
                    });
                }
            });
        }
    });
    }else{
      console.log('would be updating over here.')
    }

    return defer.promise;
}

Updater.prototype.install = function(downloadPath) {
    var os = this.os;
    var promise;
    if(os === 'windows') {
        promise = installWindows;
    } else if(os === 'linux') {
        promise = installLinux;
    } else if(os === 'mac') {
        promise = installOSX;
    } else {
        return Q.reject('Unsupported OS');
    }

    return promise(downloadPath, this.updateData);
};

Updater.prototype.displayNotification = function() {
    /*
    var self = this;
    var $el = $('#notification');
    $el.html(
        '<h1>' + this.updateData.title + ' Installed</h1>'   +
        '<p>&nbsp;- ' + this.updateData.description + '</p>' +
        '<span class="btn-grp">'                        +
            '<a class="btn chnglog">Changelog</a>'      +
            '<a class="btn restart">Restart Now</a>'    +
        '</span>'
    ).addClass('blue');

    var $restart = $('.btn.restart'),
        $chnglog = $('.btn.chnglog');

    $restart.on('click', function() {
        var argv = gui.App.fullArgv;
        argv.push(self.outputDir);
        spawn(process.execPath, argv, { cwd: self.outputDir, detached: true, stdio: [ 'ignore', 'ignore', 'ignore' ] }).unref();
        gui.App.quit();
    });

    $chnglog.on('click', function() {
        var $changelog = $('#changelog-container').html(_.template($('#changelog-tpl').html())(this.updateData));
        $changelog.find('.btn-close').on('click', function() {
            $changelog.hide();
        });
        $changelog.show();
    });

    $('body').addClass('has-notification');
    */
};

Updater.prototype.update = function() {
    var outputFile = path.join(path.dirname(this.outputDir), FILENAME);

    if(this.updateData){
        return this.download(this.updateData.updateUrl, outputFile)
            .then(forcedBind(this.verify, this))
            .then(forcedBind(this.install, this))
    }else{
        var self = this;
        console.log("checking with known method")
        return this.check().then(function(updateAvailable){
            console.log("is update available?")
            console.log(updateAvailable)
            if(updateAvailable){
                console.log("update is available!")
                return self.download(self.updateData.updateUrl, outputFile)
                    .then(forcedBind(self.verify, self))
                    .then(forcedBind(self.install, self));
            }else{
                console.log("not updating this thing")
                return false
            }
        })
    }


};

module.exports = Updater
