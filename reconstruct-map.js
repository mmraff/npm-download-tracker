/*
TODO:
* put this file in a minor version update of npm-package-dl-tracker
* replace the corresponding code in dltracker.js with use of this module
* Note that when this is made exterior to dltracker.js, the only remaining use
  of npm-package-filename there is the check on whether the filename in a
  record has a tarball extension, in auditOne()
* replace the require() of this from the local directory in this module with
    const reconstructMap = require('npm-package-dl-tracker/reconstruct-map')
*/

const fs = require('graceful-fs')
const npf = require('npm-package-filename')

module.exports = reconstructMap

// Helper for initialization: used on a list of items for which
// there is no mapping in the dltracker.json file.
// (We're keeping this factored out of reconstructMap in case we introduce
// another use for it, e.g., "phantoms")
function iterateAndAdd(itemList, map) {
  let name, version, table
  for (let i = 0; i < itemList.length; ++i) {
    const filename = itemList[i]
    const parsed = npf.parse(filename)
    if (!parsed) { // non-compliant entry
// TODO: decide what to do with the log.warn call
      //log.warn('DownloadTracker', `failed to parse filename '${filename}'`)
      continue
    }
    switch (parsed.type) {
      case 'semver':
        name = parsed.packageName
        version = parsed.versionComparable
        if (!map.semver) map.semver = {}
        if (!map.semver[name]) map.semver[name] = {}
        table = map.semver[name]
        break
      case 'git':
        name = parsed.repo
        version = parsed.commit
        if (!map.git) map.git = {}
        if (!map.git[name]) map.git[name] = {}
        table = map.git[name]
        break
      case 'url':
        if (!map.url) map.url = {}
        table = map.url
        version = parsed.url
        break
      default:
        log.warn('DownloadTracker', `unrecognized parsed type '${parsed.type}'`)
        continue
    }
    table[version] = { filename: filename }
  }
}

function reconstructMap(dir, cb) {
  if (dir == undefined || dir == null)
    throw new SyntaxError("No path given")
  if (typeof dir != 'string' || !dir.length)
    throw new TypeError("First argument must be a non-empty string")
  if (cb == undefined || cb == null)
    throw new SyntaxError("No callback given")
  if (typeof cb != 'function')
    throw new TypeError("Second argument must be a function")

  // Recognize anything that looks like a package file in the
  // given directory, and table it
  fs.readdir(dir, function(err, files) {
    if (err) return cb(err)

    const map = {}
    iterateAndAdd(files, map)
    cb(null, map)
  })
}

