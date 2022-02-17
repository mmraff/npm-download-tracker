# @offliner/npm-downloadtracker
Package tarball data store manager for the **npm-two-stage** project

## Overview
The  purposes of this module are:
* to associate critical installation-related data with downloaded package tarballs
* to help the package downloader avoid redundant downloads 
* to provide information to the **offliner** module for installation of downloaded packages
* to provide a means to validate the information mapped in a dltracker.json file with respect to the download directory that contains it

Where package tarball filenames (and Git repo identifiers) are of concern, this module is meant to be used in tandem with the module **@offliner/npm-package-filename**.


## Install

```bash
npm install @offliner/npm-downloadtracker
````


## Usage Examples

```js
const dltFactory = require('@offliner/npm-downloadtracker')

// ...

dltFactory.create('path/to/put/tarballs').then(tracker => {
  if (!tracker.contains('semver', packageName, spec))
    doSomethingWith(tracker)
})

// ...

const inData = {
  name: packageName,
  version: packageVer,
  filename: uniqueFilename,
  // whatever else is useful...
}
tracker.add('semver', inData).then(() => {
  goToNextAction()
})

tracker.contains('semver', pkgName, pkgVer) // --> true

// ...

const outData = tracker.getData('semver', pkgName, pkgVer)
/* -->
  outData contains everything in inData, with the additional field 'type'
*/

// ...

tracker.serialize().then(() => {
  finishUp()
}
```


## Main Module API

### `dltFactory.typeMap`
A hash of `npm-package-arg` package types to `npm-package-dl-tracker` package types.
```js
dltFactory.typeMap['version']   // --> 'semver'
dltFactory.typeMap['tag']       // --> 'tag'
dltFactory.typeMap['git']       // --> 'git'
dltFactory.typeMap['remote']    // --> 'url'
dltFactory.typeMap['directory'] // --> undefined
dltFactory.typeMap['file']      // --> undefined
```

A value from this mapping is to be used as the first argument to instance methods `add()`, `contains()`, and `getData()`.

Only the ones that are meaningful in this context are defined.

### `dltFactory.create(where[, options])` &rarr; `Promise<trackerInstance>`
Factory function to create a tracker instance.
* `where` {string || `undefined` || `null`} Path to put/find tarballs

  If no argument or empty value is given, the current directory will be used.

* `options` {object || `undefined` || `null`} *Optional*
  * `log` {object} *Optional*

  If `log` option present, must have these methods: `error`, `warn`, `info`, `verbose`

## Instance API

### `tracker.path`
{string} The absolute path adopted by this instance for location of tarballs

### `tracker.add(type, data)` &rarr; `Promise<empty>`
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

### `tracker.serialize()` &rarr; `Promise<boolean>`
If `tracker.add()` has previously been called successfully since instantiation/last call to `serialize()`, writes the modified state to a file named dltracker.json in the adopted directory (**`tracker.path`**), and resolves to `true`.
Otherwise, does nothing, and resolves to `false`.

### `tracker.audit()` &rarr; `Promise<Array>`
Runs checks on the items in the current data, including the condition of each file.
Resolves to an Array of objects describing problems discovered in the current tracker data, if any; otherwise an empty Array.
Each element object contains the following fields:
* `data` {object} The same data as returned by `tracker.getData()`
* `error` {Error} The error encountered for the package identified by `data`

------
## Submodule API: `reconstruct-map.js`
Primary purpose is to recreate the tracker data structure for a directory of packages that has no JSON file, though it can also be used without harm even if there is a dltracker.json file in the directory.
```js
const reconstructMap = require('@offliner/npm-downloadtracker/reconstruct-map')

// ...

reconstructMap('path/to/tarballs').then(map => {
  handleTrackerMap(map)
})

```
### `reconstructMap(dir[, log])` &rarr; `Promise<object>`
* `dir` {string} Path to find tarballs
* `log` {object || `undefined` || `null`} *Optional*

  If given, must have these methods: `error`, `warn`, `info`, `verbose`

The resolved object contains a tree structure, in which the possible topmost fields are `semver`, `git`, and `url`.
When any of these is present, package key values map down to the bare minimum of data for every package tarball (that has a parseable name) found in the given directory.

```
<object>
    |
    |------------------------------------------ 'git'
    |                                             |
    |-- 'semver'                                  |-- <repoIdentifier1>
    |       |                                     |           |
    |       |-- <packageName1>                    |           |-- <commitHashA>: <data>
    |       |         |                           |           |
    |       |         |-- <versionA>: <data>      |           ...
    |       |         |                           ...
    |       |         ...
    |       ...
    |
    |-- 'url'
    |     |
    |     |-- <URL>: <data>
    |     |  
    |     ...
```

------

**License: Artistic 2.0**
