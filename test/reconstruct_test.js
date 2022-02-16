const path = require('path')
const promisify = require('util').promisify

const expect = require('chai').expect
const fs = require('graceful-fs')
const mkdirAsync = promisify(fs.mkdir)
const npf = require('@offliner/npm-package-filename')
const rimraf = require('rimraf')
const rimrafAsync = promisify(rimraf)

const ut = require('./lib/utilities')
const reconstructMap = require('../reconstruct-map')

const didNotRejectError = new Error("Failed to reject")
const emptyArgs = [ undefined, null, '' ]
const notStringArgs = [ 42, true, {}, [] ]
const tempDir = 'test/assets/dir3'
const filenames = Object.values(ut.tarballNames)
const notPackageFilename = 'ThisDoesNotLookLikeAPackage.tgz'
filenames.push(notPackageFilename)

describe('reconstructMap module', function() {
  before('make clean temp directory and populate', function(done) {
    const filepaths = filenames.map(name => path.join(tempDir, name))
    function iterateFiles(i) {
      if (i >= filepaths.length) return done()
      fs.writeFile(filepaths[i], '', function(err) {
        if (err) return done(err)
        iterateFiles(++i)
      })
    }
    rimrafAsync(tempDir).then(() => mkdirAsync(tempDir))
    .then(() => iterateFiles(0))
  })
  after('remove temporary test assets', function(done) {
    rimraf(tempDir, done)
  })

  it('should reject if empty value given for path', function(done) {
    reconstructMap().then(() => { throw didNotRejectError })
    .catch(err => {
      expect(err).to.be.an.instanceOf(SyntaxError)
    })
    .then(() => {
      function iterateEmptyArgs(i) {
        if (i >= emptyArgs.length) return Promise.resolve(null)
        return reconstructMap(emptyArgs[i])
        .then(() => { throw didNotRejectError })
        .catch(err => {
          expect(err).to.be.an.instanceOf(SyntaxError)
          return iterateEmptyArgs(i+1)
        })
      }

      return iterateEmptyArgs(0).then(() => done())
    })
    .catch(err => done(err))
  })

  it('should reject if path value is not a string', function(done) {
    function iterateNonStringArgs(i) {
      if (i >= notStringArgs.length) return Promise.resolve(null)
      return reconstructMap(notStringArgs[i])
      .then(() => { throw didNotRejectError })
      .catch(err => {
        expect(err).to.be.an.instanceOf(TypeError)
        return iterateNonStringArgs(i+1)
      })
    }

    iterateNonStringArgs(0).then(() => done())
    .catch(err => done(err))
  })

  it('should reject when given invalid values for logger', function(done) {
    function nopFunc() {}
    const notObjects = [ 42, true, 'example' ]
    const notLoggers = [
      {},
      { error: nopFunc, warn: nopFunc, info: nopFunc }, // missing 'verbose'
      { error: "SURPRISE", warn: nopFunc, info: nopFunc, verbose: nopFunc }
    ]

    function iterateNonObjects(i) {
      if (i >= notObjects.length) return Promise.resolve(null)
      return reconstructMap(tempDir, notObjects[i])
      .then(() => { throw didNotRejectError })
      .catch(err => {
        expect(err).to.be.an.instanceOf(TypeError)
        return iterateNonObjects(i+1)
      })
    }

    function iterateNonLoggers(i) {
      if (i >= notLoggers.length) return Promise.resolve(null)
      return reconstructMap(tempDir, notLoggers[i])
      .then(() => { throw didNotRejectError })
      .catch(err => {
        expect(err).to.be.an.instanceOf(TypeError)
        return iterateNonObjects(i+1)
      })
    }

    iterateNonObjects(0)
    .then(() => iterateNonLoggers(0))
    .then(() => done())
    .catch(err => done(err))
  })

  let currMap = null

  it('should resolve to a plain object when given an existing directory', function(done) {
    reconstructMap(tempDir).then(map => {
      expect(map).to.be.an('object')
      expect(Object.getPrototypeOf(map)).to.equal(Object.getPrototypeOf({}))
      currMap = map
      done()
    })
    .catch(err => done(err))
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
