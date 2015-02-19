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
var to5 = require('gulp-6to5');
var transpile = require('gulp-es6-module-transpiler');

module.exports = function(options) {
  var bundleFileName = options.bundleFileName;

  gulp.task('build', function(done) {
    runSequence('clean', ['soy', 'copy'], ['build:globals', 'build:min'], done);
  });

  gulp.task('build:globals', ['jspm'], function() {
    return gulp.src('src/**/*.js')
      .pipe(sourcemaps.init())
      .pipe(renamer({
        basePath: process.cwd(),
        configPath: path.resolve('config.js')
      }))
      .pipe(transpile({
        basePath: process.cwd(),
        bundleFileName: bundleFileName,
        formatter: new GlobalsFormatter({
          globalName: 'aui'
        })
      }))
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
      gutil.log(gutil.colors.red('err', err.stack || err))
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
    return gulp.src('src/*.soy')
      .pipe(plugins.soynode())
      .pipe(plugins.wrapper({
        header: '/* jshint ignore:start */',
        footer: 'export default templates;\n/* jshint ignore:end */'
      }))
      .pipe(plugins.ignore.exclude('*.soy'))
      .pipe(gulp.dest('src'));
  });

  gulp.task('test', function(done) {
    return runSequence('test:unit', 'test:complexity', done);
  });

  gulp.task('test:complexity', function() {
    return gulp.src(['src/**/*.js', '!src/promise/Promise.js', 'test/**/*.js'])
      .pipe(to5())
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
      browsers: ['Chrome', 'Firefox', 'Safari']
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

function runKarma(config, done) {
  config = merge({
    configFile: path.resolve('karma.conf.js'),
    singleRun: true
  }, config);
  karma.start(config, done);
}
