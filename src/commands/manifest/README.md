# Manifest

(At the time of writing...)

## Dev

First build the bundle:

```
npm run build:dist
```

Then run it like these examples:

```
# Scala:
npm exec socket manifest scala -- --bin ~/apps/sbt/bin/sbt ~/socket/repos/scala/akka
# Gradle/Kotlin
npm exec socket manifest yolo -- --cwd  ~/socket/repos/kotlin/kotlinx.coroutines
```

And upload with this:

```
npm exec socket scan create -- --repo=depscantmp --branch=mastertmp --tmp --cwd ~/socket/repos/scala/akka socketdev .
npm exec socket scan create -- --repo=depscantmp --branch=mastertmp --tmp --cwd ~/socket/repos/kotlin/kotlinx.coroutines .
```

(The `cwd` option for `create` is necessary because we can't go to the dir and run `npm exec`).

## Prod

User flow look something like this:

```
socket manifest scala .
socket manifest kotlin .
socket manifest yolo

socket scan create --repo=depscantmp --branch=mastertmp --tmp socketdev .
```
