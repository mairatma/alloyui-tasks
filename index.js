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
var tunic = require('tunic');

function handleError(error) {
  console.error(error.toString());

  this.emit('end');
}

module.exports = function(options) {
  var bundleFileName = options.bundleFileName;
  var corePathFromSoy = options.corePathFromSoy || 'aui';
  var taskPrefix = options.taskPrefix || '';
  var buildDest = options.buildDest || 'build';
  var buildSrc = options.buildSrc || 'src/**/*.js';
  var jspmConfigFile = options.jspmConfigFile || 'config.js';
  var soyBase = options.soyBase;
  var soyDest = options.soyDest || 'src';
  var soyGenerationGlob = options.soyGenerationGlob === undefined ? '*.soy' : options.soyGenerationGlob;
  var soyGeneratedOutputGlob = options.soyGeneratedOutputGlob === undefined ? '*.soy' : options.soyGeneratedOutputGlob;
  var soySrc = options.soySrc || 'src/**/*.soy';
  var globalName = options.globalName || 'aui';

  gulp.task(taskPrefix + 'build:globals', [taskPrefix + 'soy'], function() {
    return gulp.src(buildSrc)
      .pipe(sourcemaps.init())
      .pipe(renamer({
        basePath: process.cwd(),
        configPath: path.resolve(jspmConfigFile)
      })).on('error', handleError)
      .pipe(transpile({
        basePath: process.cwd(),
        bundleFileName: bundleFileName,
        formatter: new GlobalsFormatter({
          globalName: globalName
        })
      }))
      .pipe(babel({
        blacklist: 'useStrict',
        compact: false
      })).on('error', handleError)
      .pipe(sourcemaps.write('./'))
      .pipe(gulp.dest(buildDest));
  });

  gulp.task(taskPrefix + 'jspm', function(done) {
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

  gulp.task(taskPrefix + 'soy', function(done) {
    gulp.src(soySrc, {base: soyBase})
      .pipe(plugins.if(soyGenerationGlob, generateTemplatesAndExtractParams()))
      .pipe(plugins.if(soyGeneratedOutputGlob, gulp.dest(buildDest)))
      .pipe(plugins.if(!soyGeneratedOutputGlob, plugins.if(soyGenerationGlob, gulp.dest('temp'))))
      .pipe(plugins.soynode({
        loadCompiledTemplates: false,
        shouldDeclareTopLevelNamespaces: false
      }))
      .pipe(plugins.ignore.exclude('*.soy'))
      .pipe(plugins.wrapper({
        header: getHeaderContent(corePathFromSoy),
        footer: getFooterContent
      }))
      .pipe(gulp.dest(soyDest))
      .on('end', function() {
        del('temp', done);
      });
  });

  gulp.task(taskPrefix + 'test', function(done) {
    return runSequence(taskPrefix + 'test:unit', done);
  });

  gulp.task(taskPrefix + 'test:unit', [taskPrefix + 'soy'], function(done) {
    runKarma({}, done);
  });

  gulp.task(taskPrefix + 'test:coverage', [taskPrefix + 'soy'], function(done) {
    runKarma({}, function() {
      open(path.resolve('coverage/lcov/lcov-report/index.html'));
      done();
    });
  });

  gulp.task(taskPrefix + 'test:browsers', [taskPrefix + 'soy'], function(done) {
    runKarma({
      browsers: ['Chrome', 'Firefox', 'Safari', 'IE9 - Win7', 'IE10 - Win7', 'IE11 - Win7']
    }, done);
  });

  gulp.task(taskPrefix + 'test:saucelabs', [taskPrefix + 'jspm', taskPrefix + 'soy'], function(done) {
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

  gulp.task(taskPrefix + 'test:watch', [taskPrefix + 'soy'], function(done) {
    gulp.watch(soySrc, [taskPrefix + 'soy']);

    runKarma({
      singleRun: false
    }, done);
  });
};

// Private helpers
// ===============

function addTemplateParam(filePath, namespace, templateName, param) {
  var soyJsPath = filePath + '.js';
  templateName = namespace + '.' + templateName;
  templateParams[soyJsPath] = templateParams[soyJsPath] || {};
  templateParams[soyJsPath][templateName] = templateParams[soyJsPath][templateName] || [];
  templateParams[soyJsPath][templateName].push(param);
}

function createComponentElementSoy(moduleName, hasElementTemplate) {
  var fileString = '';
  if (!hasElementTemplate) {
    fileString += '\n/**\n * @param? elementContent\n * @param? elementClasses\n * @param id\n */\n' +
      '{deltemplate ' + moduleName + ' variant="\'element\'"}\n' +
        '<div id="{$id}" class="' + moduleName.toLowerCase() + ' component{$elementClasses ? \' \' + $elementClasses : \'\'}" data-component="">\n' +
          '{$elementContent}\n' +
        '</div>\n' +
      '{/deltemplate}\n';
  }
  fileString += '\n/**\n */\n' +
    '{deltemplate ComponentElement variant="\'' + moduleName + '\'"}\n' +
      '{delcall ' + moduleName + ' variant="\'element\'" data="all" /}\n' +
    '{/deltemplate}\n';
  return fileString;
}

function createComponentSoy(moduleName) {
  return '\n/**\n * @param? elementContent\n * @param? elementClasses\n * @param id\n */\n' +
    '{deltemplate ' + moduleName + '}\n' +
      '{delcall Component data="all"}\n' +
        '{param componentName: \'' + moduleName + '\' /}\n' +
      '{/delcall}\n' +
    '{/deltemplate}\n';
}

function createComponentTemplateSoy(moduleName) {
  return '\n/**\n */\n' +
    '{deltemplate ComponentTemplate variant="\'' + moduleName + '\'"}\n' +
    '{delcall ComponentElement data="all" variant="\'' + moduleName + '\'"}\n' +
      '{param elementContent kind="html"}\n' +
        '{if not $ij.skipNestedComponentContents}\n' +
          '{call .content data="all" /}\n' +
        '{/if}\n' +
      '{/param}\n' +
    '{/delcall}\n' +
  '{/deltemplate}\n';
}

function createSurfaceElementSoy(moduleName, surfaceName, hasElementTemplate) {
  if (!hasElementTemplate) {
    return '\n/**\n * @param? elementContent\n * @param id\n */\n' +
      '{deltemplate ' + moduleName + '.' + surfaceName + ' variant="\'element\'"}\n' +
        '<div id="{$id}-' + surfaceName + '">\n' +
          '{$elementContent}\n' +
        '</div>\n' +
      '{/deltemplate}\n';
  }
  return '';
}

function createSurfaceSoy(moduleName, surfaceName) {
  return '\n/**\n * @param? elementContent\n * @param id\n */\n' +
    '{deltemplate ' + moduleName + '.' + surfaceName + '}\n' +
      '{delcall ' + moduleName + '.' + surfaceName + ' variant="\'element\'" data="all"}\n' +
        '{param elementContent kind="html"}\n' +
            '{if not $ij.skipSurfaceContents}\n' +
              '{call .' + surfaceName + ' data="all" /}\n' +
            '{/if}\n' +
        '{/param}\n' +
      '{/delcall}\n' +
    '{/deltemplate}\n';
}

var templateParams = {};
function extractTemplateParams(namespace, templateName, templateString, filePath) {
  var paramRegex = /{@param \s*(\S*)\s*:(.*)}/g;
  var currentMatch = paramRegex.exec(templateString);
  while (currentMatch) {
    addTemplateParam(filePath, namespace, templateName, currentMatch[1]);
    currentMatch = paramRegex.exec(templateString);
  }
}

function generateDelTemplate(namespace, templateName, hasElementTemplate) {
  var moduleName = namespace.substr(10);
  if (templateName === 'content') {
    return createComponentSoy(moduleName) + createComponentTemplateSoy(moduleName) +
      createComponentElementSoy(moduleName, hasElementTemplate);
  } else {
    return createSurfaceElementSoy(moduleName, templateName, hasElementTemplate) +
      createSurfaceSoy(moduleName, templateName);
  }
}

function generateTemplatesAndExtractParams() {
  return through.obj(function(file, encoding, callback) {
    var fileString = file.contents.toString(encoding);
    fileString += '\n// The following templates were generated by alloyui-tasks.\n' +
      '// Please don\'t edit them by hand.\n';

    var namespace = /{namespace (.*)}/.exec(fileString)[1];

    var templateCmds = getAllTemplateCmds(file.contents);
    var hasElementTemplateMap = getHasElementTemplateMap(templateCmds);
    var moduleName = namespace.substr(10);

    templateCmds.forEach(function(cmd) {
      if (cmd.deltemplate) {
        return;
      }

      var fullName = cmd.name === 'content' ? moduleName : moduleName + '.' + cmd.name;
      fileString += generateDelTemplate(namespace, cmd.name, hasElementTemplateMap[fullName]);
      extractTemplateParams(namespace, cmd.name, cmd.contents, file.relative);

      cmd.docTags.forEach(function(tag) {
        if (tag.tag === 'param' && tag.name !== '?') {
          addTemplateParam(file.relative, namespace, cmd.name, tag.name);
        }
      });
    });

    file.contents = new Buffer(fileString);
    this.push(file);
    callback();
  });
}

function getAllTemplateCmds(contents) {
  var cmds = [];
  var ast = tunic().parse(contents);
  ast.blocks.forEach(function(block, index) {
    var code = ast.blocks[index + 1];
    if (block.type === 'Comment' && code && code.type === 'Code') {
      var templateInfo = getTemplateInfo(code.contents);
      if (templateInfo) {
        cmds.push(merge({
          contents: code.contents,
          docTags: block.tags
        }, templateInfo));
      }
    }
  });

  return cmds;
}

function getFooterContent(file) {
  var footer = '';
  var fileParams = templateParams[file.relative];
  for (var templateName in fileParams) {
    footer += '\n' + templateName + '.params = ' + JSON.stringify(fileParams[templateName]) + ';';
  }
  return footer + '\n/* jshint ignore:end */\n';
}

function getHasElementTemplateMap(templateCmds) {
  var hasElementTemplateMap = {};
  templateCmds.forEach(function(cmd) {
    if (cmd.deltemplate && cmd.variant === 'element') {
      hasElementTemplateMap[cmd.name] = true;
    }
  });
  return hasElementTemplateMap;
}

function getHeaderContent(corePathFromSoy) {
  return function(file) {
    var corePath = corePathFromSoy;
    if (typeof corePath === 'function') {
      corePath = corePathFromSoy(file);
    }
    var registryModulePath = path.join(corePath, '/component/ComponentRegistry');
    return '/* jshint ignore:start */\n' +
      'import ComponentRegistry from \'' + registryModulePath + '\';\n' +
      'var Templates = ComponentRegistry.Templates;\n';
  };
}

function getTemplateInfo(templateString) {
  var info = {};
  var match = /{template (.*)}/.exec(templateString);
  if (match){
    info.name = match[1].substr(1);
  } else {
    var regex = new RegExp('{deltemplate (\\S+)\\s*(variant="\'(\\w+)\'")?\\s*}');
    match = regex.exec(templateString);
    if (match) {
      info.deltemplate = true;
      info.name = match[1];
      info.variant = match[3];
    }
  }

  return info;
}

function runKarma(config, done) {
  config = merge({
    configFile: path.resolve('karma.conf.js'),
    singleRun: true
  }, config);
  karma.start(config, done);
}
