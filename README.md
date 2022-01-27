# npm-package-dl-tracker
Package tarball data store manager for the **npm-two-stage** project

## Overview
The  purposes of this module are:
* to associate critical installation-related data with downloaded package tarballs
* to help the package downloader avoid redundant downloads 
* to provide information to the **offliner** module for installation of downloaded packages
* to provide a means to validate the information mapped in a dltracker.json file with respect to the download directory that contains it

Where package tarball filenames (and Git repo identifiers) are of concern, this module is meant to be used in tandem with the module **npm-package-filename**.


## Install

```bash
npm install npm-package-dl-tracker
````


## Usage

```js
const dltFactory = require('npm-package-dl-tracker')

// ...

dltFactory.create('path/to/put/tarballs', function(err, tracker) {
  if (err) return fallback(err)
  proceedWithTracker(tracker)
})

// ...

const inData = {
  name: pkgName,
  version: pkgVer,
  filename: uniqueFilename,
  // whatever else is useful...
}
tracker.add('semver', inData, function(err) {
  if (err) return fallback(err)
  next()
})

tracker.contains('semver', pkgName, pkgVer) // --> true

// ...

const outData = tracker.getData('semver', pkgName, pkgVer)
/* -->
  outData contains everything in inData, with the additional field 'type'
*/

// ...

tracker.serialize(function(err) {
  if (err) return abort(err)
  finishUp()
}
```


## Main Module API

### `dltFactory.typeMap`
A hash of `npm-package-arg` package types to `npm-package-dl-tracker` package types.
```js
dltFactory.typeMap['version'] // --> 'semver'
dltFactory.typeMap['tag']     // --> 'tag'
dltFactory.typeMap['git']     // --> 'git'
dltFactory.typeMap['remote']  // --> 'url'
dltFactory.typeMap['file']    // --> undefined
```

A value from this mapping is to be used as the first argument to instance methods `add()`, `contains()`, and `getData()`.

Only the ones that are meaningful in this context are defined.

### `dltFactory.create(where, [options,] cb)`
Factory function to instantiate a tracker instance.
* `where` {string || `undefined` || `null`} Path to put/find tarballs

  If empty value is given, the current directory will be used.

* `options` {object || `undefined` || `null`} *Optional*
  * `log` {object} *Optional*

  If `log` option present, must have these methods: `error`, `warn`, `info`, `verbose`

* `cb` {function} Callback
  * `error` {Error || `null`}
  * `tracker` {object} New download-tracker instance, if no error

## Instance API

### `tracker.path`
{string} The absolute path adopted by this instance for location of tarballs

### `tracker.add(type, data, cb)`
* `type` {string} One of the values from **`dltFactory.typeMap`** (see above)
* `data` {object} Contains fields to associate with a given tarball.
  Arbitrary extra fields may be included with required fields.

  For `type` `'semver'`, required fields are:
  * `name` {string}
  * `version` {string}
  * `filename` {string} The name of the tarball file

  For `type` `'tag'`, required fields are same as for `'semver'` with one more:
  * `spec` {string} The tag

  For `type` `'git'`, required fields are:
  * `repo` {string} A unique identifier for a git repository
  * `commit` {string} The git hash that identifies a commit in the given repository
  * `filename` {string} The name of the tarball file

  If a field called `refs` is included in data of `type` `'git'`, it must be an
  Array of strings; the strings will be interpreted as tags, and each will be
  treated as an alias for the commit.

  For `type` `'url'`, required fields are:
  * `spec` {string} A remote URL
  * `filename` {string} The name of the tarball file

* `cb` {function} Callback
  * `error` {Error || `undefined`}

### `tracker.contains(type, name, spec)`
*Synchronous*
* `type` {string} One of the values from **`dltFactory.typeMap`** (see above)
* `name` {string}

  For `type` `'semver'` or `'tag'`, must be the package name

  For `type` `'git'`, must be the git repo identifier (see **`tracker.add()`** above)

  For `type` `'url'`, must be empty (`''` || `null` || `undefined`)

* `spec` {string}

  For `type` `'semver'`, must be the package version

  For `type` `'tag'`, must be the version tag

  For `type` `'git'`, can be...
  - a git commit hash
  - a git tag
  - a valid Semver 2.0 expression prefixed by `'semver:'`
  - empty string or `'*'`, which will match if there is a 'master' or 'main' tag or only one commit present for the named repo

  For `type` `'url'`, must be a remote URL

* Returns: {boolean} Whether the identified package has been added

***Caveat:*** For `type` `'tag'`, if the value of `spec` is `'latest'` or `''`, the call will tell if *any* version of the named package has been added.

### `tracker.getData(type, name, spec)`
*Synchronous*

Same argument requirements as for `contains()`.
* Returns: {object || `null`}

  If the identified package was previously added, this will contain the same data passed to `tracker.add()`, with the additional field `type`. If `type` `'git'`, and a tag or a `'semver:'`-prefixed expression is given, then a `spec` field with that value will be included.

***Caveat:*** For `type` `'tag'`, if the value of `spec` is `'latest'` or `''`, the call will return the data of the highest version added, which is not necessarily the current latest version.

### `tracker.serialize(cb)`
Writes the current modified state to a file named dltracker.json in the adopted directory (**`tracker.path`**).
Does nothing if there has not been a call to **`tracker.add()`** since instantiation or since the last call to **`tracker.serialize()`**.
* `cb` {function} Callback
  * `error` {Error || `undefined`}

### `tracker.audit(cb)`
Runs checks on the items in the current data, including the condition of each file.
* `cb` {function} Callback
  * `error` {Error || `null`}
  * `list` {Array} A list of objects describing problems discovered in the current tracker data, if any:
    * `data` {object} The same data as returned by `tracker.getData()`
    * `error` {Error} The error encountered for the package identified by `data`


## Submodule API: `reconstruct-map.js`
Primary purpose is to recreate the tracker data structure for a directory of packages that has no JSON file, though it can also be used without harm even if there is a dltracker.json file in the directory.
```js
const reconstructMap = require('npm-package-dl-tracker/reconstruct-map')

// ...

reconstructMap('path/to/tarballs', function(err, map) {
  if (err) return handleError(err)
  handleTrackerMap(map)
})

```
### `reconstructMap(dir, [log,] cb)`
* `dir` {string} Path to find tarballs
* `log` {object || `undefined` || `null`} *Optional*

  If given, must have these methods: `error`, `warn`, `info`, `verbose`

* `cb` {function} Callback
  * `error` {Error || null}
  * `map` {object}

  The result object contains a tree structure with the bare minimum of data for every package tarball (with a parseable name) found in the given directory.

------

**License: Artistic 2.0**
