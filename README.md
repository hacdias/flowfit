# flowfit

> The app [RunGap](https://www.rungap.com/) can successfully import FIT files from the Bosch eBike Flow app. Therefore, I am archiving this.

`flowfit` takes a FIT file from Bosch's eBike [Flow](https://www.bosch-ebike.com/nl/producten/ebike-flow-app) app and magically cleans it, such that it can be imported by other apps correctly. This means:

- Consolidating multiple records for the same timestamp into one.
- Ensuring pause events exist if there are no timestamps for over 5 seconds.
- Ensuring the lap message is correct (only supports 1).
- Ensuring the session message is correct (only supports 1).
- Ensuring there is an activity message.

I made this out of my frustration with the Flow app synchronization with Apple Health, which you can read more on my [website](https://hacdias.com/2023/10/11/processing-bosch-ebike-flow-fit-files/). I will be updating this module as I see fit (pun intended). I am hopeful that Bosch will simply fix their own integration and this module will no longer be necessary.

## Build and Install

```bash
$ swift build -c release

# Change the platform directory as needed.
$ cp ./.build/arm64-apple-macosx/release/flowfit /usr/local/bin/flowfit
```

## Usage

Run `flowfit --help` for more information.

## License

MIT © Henrique Dias
