const path = require('path')

const expect = require('chai').expect
const fs = require('graceful-fs')
const npf = require('npm-package-filename')
const rimraf = require('rimraf')

const ut = require('./lib/utilities')
const reconstructMap = require('../reconstruct-map')

function shouldNotRunFunc(err, data) {
  throw new Error('This dummy function should never get called!')
}
function nopFunc() {}

const emptyArgs = [ undefined, null, '' ]
const notStringArgs = [ 42, true, {}, [] ]
const notFunctions = [ 42, true, 'example', {}, [] ]
const tempDir = 'test/assets/dir3'
const filenames = Object.values(ut.tarballNames)
const notPackageFilename = 'ThisDoesNotLookLikeAPackage.tgz'
filenames.push(notPackageFilename)

describe('reconstructMap module', function() {
  before('make clean temp directory and populate', function(done) {
    const filepaths = filenames.map(function(name) {
      return path.join(tempDir, name)
    })
    function nextFile(i) {
      if (i >= filepaths.length) return done()
      fs.writeFile(filepaths[i], '', function(err) {
        if (err) return done(err)
        nextFile(++i)
      })
    }
    ut.makeCleanDir(tempDir, function(){ nextFile(0) }, done)
  })
  after('remove temporary test assets', function(done) {
    rimraf(tempDir, done)
  })

  it('should throw if empty value given for path', function() {
    expect(function() { reconstructMap() }).to.throw(SyntaxError)
    for (let i = 0; i < emptyArgs.length; ++i)
      expect(function() {
        reconstructMap(emptyArgs[i], shouldNotRunFunc)
      }).to.throw(SyntaxError)
  })

  it('should throw if path value is not a string', function() {
    for (let i = 0; i < notStringArgs.length; ++i)
      expect(function() {
        reconstructMap(notStringArgs[i], shouldNotRunFunc)
      }).to.throw(TypeError)
  })

  it('should throw if no callback given', function() {
    expect(function() { reconstructMap(tempDir) }).to.throw(SyntaxError)
  })

  it('should throw if callback value is not a function', function() {
    for (let i = 0; i < notFunctions.length; ++i) {
      expect(function() {
        reconstructMap(tempDir, notFunctions[i])
      }).to.throw(TypeError)
      expect(function() {
        reconstructMap(tempDir, {}, notFunctions[i])
      }).to.throw(TypeError)
    }
  })

  it('should throw when given invalid values for logger', function() {
    const notObjects = [ 42, true, 'example' ]
    for (i = 0; i < notObjects.length; ++i) {
      expect(function() {
        reconstructMap(tempDir, notObjects[i], shouldNotRunFunc)
      }).to.throw(TypeError)
    }

    let notLogger = {}
    expect(function() {
      reconstructMap(tempDir, notLogger, shouldNotRunFunc)
    }).to.throw(Error)

    notLogger = { 
      error: nopFunc, warn: nopFunc, info: nopFunc // missing 'verbose'
    }
    expect(function() {
      reconstructMap(tempDir, notLogger, shouldNotRunFunc)
    }).to.throw(Error)

    notLogger.verbose = nopFunc  // correct the last problem
    notLogger.error = "SURPRISE" // but introduce another
    expect(function() {
      reconstructMap(tempDir, notLogger, shouldNotRunFunc)
    }).to.throw(TypeError)
  })

  let currMap = null

  it('should pass back a plain object when given an existing directory', function(done) {
    reconstructMap(tempDir, function(err, map) {
      if (err) return done(err)
      expect(map).to.be.an('object')
      expect(Object.getPrototypeOf(map)).to.equal(Object.getPrototypeOf({}))
      currMap = map
      done()
    })
  })

  it('the object should contain all expected data and nothing more', function() {
    expect(currMap).to.have.all.keys(['semver', 'git', 'url'])

    const semverResults = currMap.semver
    const semverInput = ut.dataKeys.semver
    const tagInput = ut.dataKeys.tag
    expect(semverResults).to.have.property(semverInput.name)
    expect(semverResults).to.have.property(tagInput.name)
    const isSameSemverName = semverInput.name == tagInput.name
    expect(Object.keys(semverResults)).to.have.lengthOf(isSameSemverName ? 1 : 2)

    expect(semverResults[semverInput.name]).to.have.property(semverInput.version)
    const semverDataFromSemver = semverResults[semverInput.name][semverInput.version]
    expect(semverDataFromSemver).to.be.an('object').that.has.all.keys(['filename'])
    expect(semverDataFromSemver.filename).to.equal(ut.tarballNames.semver)

    expect(semverResults[tagInput.name]).to.have.property(tagInput.version)
    const semverDataFromTag = semverResults[tagInput.name][tagInput.version]
    expect(semverDataFromTag).to.be.an('object').that.has.all.keys(['filename'])
    expect(semverDataFromTag.filename).to.equal(ut.tarballNames.tag)

    const gitResults = currMap.git
    const gitInput = ut.dataKeys.git
    expect(gitResults).to.be.an('object').that.has.all.keys([gitInput.repo])
    expect(gitResults[gitInput.repo]).to.be.an('object').that.has.all.keys([gitInput.commit])
    const gitData = gitResults[gitInput.repo][gitInput.commit]
    expect(gitData).to.be.an('object').that.has.all.keys(['filename'])
    expect(gitData.filename).to.equal(ut.tarballNames.git)

    const urlResults = currMap.url
    const urlInput = npf.parse(ut.tarballNames.url).url
    expect(urlResults).to.have.all.keys(urlInput)
    expect(urlResults[urlInput]).to.be.an('object').that.has.all.keys(['filename'])
    expect(urlResults[urlInput].filename).to.equal(ut.tarballNames.url)
  })
})
