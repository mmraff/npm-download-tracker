const assert = require('assert')
const fs = require('fs')

const mkdirp = require('mkdirp')
const npf = require('npm-package-filename')
const rimraf = require('rimraf')

const dataKeys = {
  semver: {
    name: 'example', version: '1.2.3',
    ranges: ['~1', '^1.2', '<2.0'],
    notRanges: ['~1.1', '<0.1 || >=1.5', '^2']
  },
  tag: { name: 'example', version: '0.1.2', spec: 'next.big.thing' },
  git: {
    domain: 'github.com',
    path: 'someUser/example',
    commit: '0123456789abcdef0123456789abcdef01234567',
    tags: ['v2.3.4', 'main']
  },
  url: 'https://example.net/someuser/example/archive/76543210.tgz'
}
dataKeys.git.repo = [ dataKeys.git.domain, '/', dataKeys.git.path ].join('')

const tarballNames = {
  semver: npf.makeTarballName({
    type: 'semver', name: dataKeys.semver.name, version: dataKeys.semver.version
  }),
  tag: npf.makeTarballName({
    type: 'semver', name: dataKeys.tag.name, version: dataKeys.tag.version
  }),
  git: npf.makeTarballName({
    type: 'git',
    domain: dataKeys.git.domain,
    path: dataKeys.git.path,
    commit: dataKeys.git.commit
  }),
  url: npf.makeTarballName({ type: 'url', url: dataKeys.url })
}

function makeCleanDir(dirPath, next, finish) {
  rimraf(dirPath, function(rmrfErr) {
    if (rmrfErr) return finish(rmrfErr)
    mkdirp(dirPath, function(mkdirpErr) {
      if (mkdirpErr) return finish(mkdirpErr)
      next()
    })
  })
}

function copyFile(from, to, cb) {
  var hadError = false
  function errorOut(err) {
    if (hadError) return
    hadError = true
    cb(err)
  }
  fs.createReadStream(from)
  .once('error', errorOut)
  .pipe(fs.createWriteStream(to, {encoding: null}))
  .once('error', errorOut)
  .once('close', function () {
    if (!hadError) cb()
  })
}

module.exports = {
  dataKeys: dataKeys,
  tarballNames: tarballNames,
  makeCleanDir: makeCleanDir,
  copyFile: copyFile
}
