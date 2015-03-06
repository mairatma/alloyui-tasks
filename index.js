'use strict';

var del = require('del');
var GlobalsFormatter = require('es6-module-transpiler-globals-formatter');
var gulp = require('gulp');
var gutil = require('gulp-util');
var jspm = require('jspm');
var jspmCore = require('jspm/lib/core');
var karma = require('karma').server;
var merge = require('merge');
var open = require('open');
var path = require('path');
var plugins = require('gulp-load-plugins')();
var renamer = require('gulp-es6-imports-renamer');
var runSequence = require('run-sequence');
var sourcemaps = require('gulp-sourcemaps');
var babel = require('gulp-babel');
var through = require('through2');
var transpile = require('gulp-es6-module-transpiler');

function handleError(error) {
  console.error(error.toString());

  this.emit('end');
}

module.exports = function(options) {
  var bundleFileName = options.bundleFileName;
  var corePathFromSoy = options.corePathFromSoy || 'aui';
  var shouldSkipSoyTemplatesGeneration = options.shouldSkipSoyTemplatesGeneration;

  gulp.task('build', function(done) {
    runSequence('clean', ['soy', 'copy'], ['build:globals', 'build:min'], done);
  });

  gulp.task('build:globals', ['jspm'], function() {
    return gulp.src('src/**/*.js')
      .pipe(sourcemaps.init())
      .pipe(renamer({
        basePath: process.cwd(),
        configPath: path.resolve('config.js')
      })).on('error', handleError)
      .pipe(transpile({
        basePath: process.cwd(),
        bundleFileName: bundleFileName,
        formatter: new GlobalsFormatter({
          globalName: 'aui'
        })
      }))
      .pipe(babel({
        blacklist: 'useStrict',
        compact: false
      })).on('error', handleError)
      .pipe(sourcemaps.write('./'))
      .pipe(gulp.dest('build'));
  });

  gulp.task('build:min', ['build:globals'], function() {
    return gulp.src(path.join('build/', bundleFileName))
      .pipe(plugins.rename(function(path) {
        path.basename += '-min';
      }))
      .pipe(plugins.uglify({
        preserveComments: 'some'
      }))
      .pipe(banner(options.pkg))
      .pipe(gulp.dest('build'));
  });

  gulp.task('clean', function(done) {
    del(['build'], done);
  });

  gulp.task('copy', function() {
    return gulp.src('src/**/*.css')
      .pipe(gulp.dest('build'));
  });

  gulp.task('jspm', function(done) {
    jspm.promptDefaults(true);
    jspm.install(true, {
      lock: true
    }).then(function() {
      return jspmCore.checkDlLoader();
    }).then(function() {
      return jspmCore.setMode('local');
    }).then(function() {
      gutil.log(gutil.colors.cyan('Install complete'));
      done();
    }, function(err) {
      gutil.log(gutil.colors.red('err', err.stack || err));
      gutil.log(gutil.colors.red('Installation changes not saved.'));
      done();
    });
  });

  gulp.task('lint', function() {
    return gulp.src(['src/**/*.js', 'test/**/*.js'])
      .pipe(plugins.jshint())
      .pipe(plugins.jshint.reporter(require('jshint-stylish')));
  });

  gulp.task('soy', function() {
    return gulp.src('src/**/*.soy')
      .pipe(plugins.if(!shouldSkipSoyTemplatesGeneration, generateTemplatesAndExtractParams()))
      .pipe(plugins.if(!shouldSkipSoyTemplatesGeneration, gulp.dest('build')))
      .pipe(plugins.soynode({
        loadCompiledTemplates: false,
        shouldDeclareTopLevelNamespaces: false
      }))
      .pipe(plugins.ignore.exclude('*.soy'))
      .pipe(plugins.wrapper({
        header: getHeaderContent(corePathFromSoy),
        footer: getFooterContent
      }))
      .pipe(gulp.dest('src'));
  });

  gulp.task('test', function(done) {
    return runSequence('test:unit', /*'test:complexity', TODO(edu): ES6.*/ done);
  });

  gulp.task('test:complexity', function() {
    return gulp.src(['src/**/*.js', '!src/**/*.soy.js', '!src/promise/Promise.js', 'test/**/*.js'])
      .pipe(babel())
      .pipe(plugins.complexity({
        halstead: [15, 15, 20]
      }));
  });

  gulp.task('test:unit', ['jspm'], function(done) {
    runKarma({}, done);
  });

  gulp.task('test:coverage', ['jspm'], function(done) {
    runKarma({}, function() {
      open(path.resolve('coverage/lcov/lcov-report/index.html'));
      done();
    });
  });

  gulp.task('test:browsers', ['jspm'], function(done) {
    runKarma({
      browsers: ['Chrome', 'Firefox', 'Safari', 'IE9 - Win7', 'IE10 - Win7', 'IE11 - Win7']
    }, done);
  });

  gulp.task('test:saucelabs', ['jspm'], function(done) {
    var launchers = {
      sl_chrome: {
        base: 'SauceLabs',
        browserName: 'chrome'
      },
      sl_safari: {
        base: 'SauceLabs',
        browserName: 'safari'
      },
      sl_firefox: {
        base: 'SauceLabs',
        browserName: 'firefox'
      },
      sl_ie_9: {
        base: 'SauceLabs',
        browserName: 'internet explorer',
        platform: 'Windows 7',
        version: '9'
      },
      sl_ie_10: {
        base: 'SauceLabs',
        browserName: 'internet explorer',
        platform: 'Windows 7',
        version: '10'
      },
      sl_ie_11: {
        base: 'SauceLabs',
        browserName: 'internet explorer',
        platform: 'Windows 8.1',
        version: '11'
      },
      sl_iphone: {
        base: 'SauceLabs',
        browserName: 'iphone',
        platform: 'OS X 10.10',
        version: '7.1'
      },
      sl_android_4: {
        base: 'SauceLabs',
        browserName: 'android',
        platform: 'Linux',
        version: '4.4'
      },
      sl_android_5: {
        base: 'SauceLabs',
        browserName: 'android',
        platform: 'Linux',
        version: '5.0'
      }
    };

    runKarma({
      browsers: Object.keys(launchers),

      browserDisconnectTimeout: 10000,
      browserDisconnectTolerance: 2,
      browserNoActivityTimeout: 240000,

      captureTimeout: 240000,
      customLaunchers: launchers,

      reporters: ['coverage', 'progress', 'saucelabs'],

      sauceLabs: {
        testName: 'AlloyUI tests',
        recordScreenshots: false,
        startConnect: true,
        connectOptions: {
          port: 5757,
          'selenium-version': '2.41.0',
          logfile: 'sauce_connect.log'
        }
      }
    }, done);
  });

  gulp.task('test:watch', ['jspm'], function(done) {
    runKarma({
      singleRun: false
    }, done);
  });

  gulp.task('watch', ['build'], function() {
    gulp.watch('src/**/*', ['build']);
  });
};

// Private helpers
// ===============

function banner(pkg) {
  var stamp = [
    '/**',
    ' * <%= pkg.name %> - <%= pkg.description %>',
    ' * @version v<%= pkg.version %>',
    ' * @author <%= pkg.author.name %> <<%= pkg.author.email %>>',
    ' * @link http://liferay.com',
    ' * @license BSD',
    ' */',
    ''
  ].join('\n');

  return plugins.header(stamp, {
    pkg: pkg
  });
}

function createComponentSoy(moduleName) {
  return '\n/**\n* @param? children\n* @param data\n* @param ref\n*/\n' +
    '{deltemplate ' + moduleName + '}\n' +
      '{delcall Component}\n' +
        '{param children: $children /}\n' +
        '{param data: $data /}\n' +
        '{param name: \'' + moduleName + '\' /}\n' +
        '{param ref: $ref /}\n' +
      '{/delcall}\n' +
    '{/deltemplate}\n';
}

function createSurfaceSoy(moduleName, surfaceName) {
  return '\n/**\n* @param id\n*/\n' +
    '{deltemplate ' + moduleName + '.' + surfaceName + '}\n' +
      '<div id="{$id}-' + surfaceName + '">\n' +
        '{if $ij.renderChildComponents}\n' +
            '{call .' + surfaceName + ' data="all" /}\n' +
        '{/if}\n' +
      '</div>\n' +
    '{/deltemplate}\n';
}

var templateParams = {};
function extractTemplateParams(namespace, templateCmd, filePath) {
  var soyJsPath = filePath + '.js';
  templateParams[soyJsPath] = templateParams[soyJsPath] || {};

  var templateName = namespace + '.' + templateCmd.name;
  templateParams[soyJsPath][templateName] = [];

  var paramRegex = /{@param \s*(\S*)\s*:(.*)}/g;
  var currentMatch = paramRegex.exec(templateCmd.contents);
  while (currentMatch) {
    templateParams[soyJsPath][templateName].push(currentMatch[1]);
    currentMatch = paramRegex.exec(templateCmd.contents);
  }
}

function generateDelTemplate(namespace, templateCmd) {
  var moduleName = namespace.substr(10);
  if (templateCmd.name === 'element') {
    return createComponentSoy(moduleName);
  } else {
    return createSurfaceSoy(moduleName, templateCmd.name);
  }
}

function generateTemplatesAndExtractParams() {
  return through.obj(function(file, encoding, callback) {
    var fileString = file.contents.toString(encoding);
    fileString += '\n// The following templates were generated by alloyui-tasks.\n' +
      '// Please don\'t edit them by hand.\n';

    var namespace = /{namespace (.*)}/.exec(fileString)[1];
    var templateCmds = getAllTemplateCmds(fileString);
    for (var i = 0; i < templateCmds.length; i++) {
      fileString += generateDelTemplate(namespace, templateCmds[i]);
      extractTemplateParams(namespace, templateCmds[i], file.relative);
    }

    file.contents = new Buffer(fileString);
    this.push(file);
    callback();
  });
}

function getFooterContent(file) {
  var footer = '';
  var fileParams = templateParams[file.relative];
  for (var templateName in fileParams) {
    footer += '\n' + templateName + '.params = ' + JSON.stringify(fileParams[templateName]) + ';';
  }
  return footer + '\n/* jshint ignore:end */\n';
}

function getHeaderContent(corePathFromSoy) {
  var registryModulePath = path.join(corePathFromSoy, '/component/ComponentRegistry');
  return '/* jshint ignore:start */\n' +
    'import ComponentRegistry from \'' + registryModulePath + '\';\n' +
    'var Templates = ComponentRegistry.Templates;\n';
}

function getAllTemplateCmds(fileString) {
  var cmds = [];
  var regex = /{template (.*)}/g;
  var match = regex.exec(fileString);
  while (match) {
    var endIndex = fileString.indexOf('{/template}', match.index);
    cmds.push({
      contents: fileString.substring(match.index, endIndex),
      name: match[1].substr(1)
    });
    match = regex.exec(fileString);
  }
  return cmds;
}

function runKarma(config, done) {
  config = merge({
    configFile: path.resolve('karma.conf.js'),
    singleRun: true
  }, config);
  karma.start(config, done);
}
