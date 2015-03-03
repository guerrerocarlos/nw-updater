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

var Decompress = require('decompress')
var events = require('events')
var util = require('util')

util.inherits(Updater, events.EventEmitter)

;

var CHANNELS = ['stable', 'beta', 'nightly'],
    FILENAME = 'package.nw.new'

var VERIFY_PUBKEY = "-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEAjjfrud4fMoIc9QSwdO0snzi5yd4bwtJYCSOA6GCtjplYPwBTNzMeOI7CFOue\nNObSNf1mQCepIVKFK+/WYNtN7z6pSVbSjU7lIT6yh+ifcZTI8ezurIrtfstFjW6LCZv4XzvZ\nK6l9zgT7Z8PfIQ7NdE2cTfJRUk7HLOsWZTiu6N63OJD6Xrt9SymLzdFnsWqCauDB2HRUXZUL\nb90JtHokEiOHCW+KiKPIFLZpBB0bobFXCHGAsZjQ+ZZfKINRoeGqzHCqUnzQFAUSsEV1tTOb\nMzlBLOT4a6T7eBLKhDGkH99cdZFXPZPVqvEzuNDMOsb5osk6FdQZtmSl6QRUslb0fQIDAQAB\n-----END RSA PUBLIC KEY-----\n"

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
        endpoint: 'http://torrentv.github.io/update.json',
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


    this.outputDir = process.cwd();
    if(this.os === "linux" || this.os === "windows"){
        this.outputDir = process.execPath
    }

    this.updateData = null;

    this.check = this.check.bind(this)
    this.download = this.download.bind(this)
    this.install = this.install.bind(this)
    this.displayNotification = this.displayNotification.bind(this)
}

Updater.prototype.check = function() {
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
        defer.resolve(false);
        return defer.promise;
    }

    request(this.options.endpoint, {json:true}, function(err, res, data) {

        if(err || !data) {
            defer.reject(err);
        } else {
            defer.resolve({"data": data, "os":self.os, "arch": this.arch, "this": self});
        }
    });

    return promise.then(function(data) {
        var self = data["this"]
        /*
        if(!_.contains(Object.keys(data), self.os)) {
            // No update for this OS, FreeBSD or SunOS.
            // Must not be an official binary
            return false;
        }*/

        var updateData = data["data"][data["os"]];
        if(data["os"] == 'linux') {
            updateData = updateData[self.arch];
        }

        // Normalize the version number
        if(!updateData.version.match(/-\d+$/)) {
            updateData.version += '-0';
        }
        if(!self.currentVersion.match(/-\d+$/)) {
            self.currentVersion += '-0';
        }

        if(semver.gt(updateData.version, self.currentVersion)) {
            self.emit('download',updateData.version)
            self.updateData = updateData;
            return true;
        }

        return false;

    });
};

Updater.prototype._download = function (downloadStream, output, defer) {
    downloadStream.pipe(fs.createWriteStream(output));
    downloadStream.on('end', function() {
        defer.resolve(output);
    });
};

Updater.prototype.download = function(source, output) {
    var defer = Q.defer();
    var self = this;
    switch (url.parse(source).protocol) {
    case 'magnet:':
        var engine = torrentStream(source);
        engine.on('ready', function() {
            var file = engine.files.pop();
            self._download(file.createReadStream(), output, defer);
        });
        break;
    case 'http:':
    case 'https:':
        self._download(request(source), output, defer);
        break;
    }
    return defer.promise;
};

Updater.prototype.verify = function(source) {
    var defer = Q.defer();
    var self = this;

    var hash = crypto.createHash('SHA1'),
        verify = crypto.createVerify('RSA-SHA256');

    var readStream = fs.createReadStream(source);
    readStream.pipe(hash);
    readStream.pipe(verify);
    readStream.on('end', function() {
        hash.end();
        verify.end();
        var hashResult = hash.read().toString('hex')
        var resultFromSign = verify.verify(VERIFY_PUBKEY, self.updateData.signature+"", 'base64')
        if(self.updateData.checksum !== hashResult ||
            resultFromSign == false
        ) {
            defer.reject('invalid hash or signature');
            self.emit("error","invalid hash or signature")
        } else {
            defer.resolve(source);
        }
    });
    return defer.promise;
};

function installWindows(downloadPath, updateData) {
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

function installWindows2(downloadPath, updateData) {
    var outputDir = path.dirname(downloadPath),
        installDir = path.join(outputDir, 'app');
    var defer = Q.defer();


    var decompress = Decompress({mode: '644'})
        .src(downloadPath)
        .dest(installDir)
        .use(Decompress.zip())

    //var pack = new zip(downloadPath);
    decompress.run(
    //pack.extractAllToAsync(installDir, true, function(err) {
    function(err) {
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

    rm(installDir, function(err) {
        if(err) {
            defer.reject(err);
        } else {
            //var pack = new zip(downloadPath);
            var decompress = Decompress({mode: '744'})
                .src(downloadPath)
                .dest(installDir)
                .use(Decompress.zip())


            //pack.extractAllToAsync(installDir, true, function(err) {
            decompress.run(function(err){
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
    var self = this;
    /*
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

    self.emit('installed')
};

Updater.prototype.update = function() {
    var outputFile = path.join(path.dirname(this.outputDir), FILENAME);

    if(this.updateData){
        return this.download(this.updateData.updateUrl, outputFile)
            .then(forcedBind(this.verify, this))
            .then(forcedBind(this.install, this))
    }else{
        var self = this;
        return this.check().then(function(updateAvailable){
            if(updateAvailable){
                return self.download(self.updateData.updateUrl, outputFile)
                    .then(forcedBind(self.verify, self))
                    .then(forcedBind(self.install, self))
                    .then(forcedBind(self.displayNotification));
            }else{
                return false
            }
        })
    }

};

module.exports = Updater
