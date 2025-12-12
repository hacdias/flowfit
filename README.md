# Flow FIT

Flow FIT takes a .FIT file exported by Bosch's eBike [Flow](https://www.bosch-ebike.com/en/products/ebike-flow-app) app and magically cleans it, such that it can be imported by other apps correctly. This means:

- Consolidating multiple records for the same timestamp into one.
- Ensuring pause events exist if there are no timestamps for over 10 seconds.
- Ensuring there is one lap per moving duration with calories based on weighted power.
- Ensuring the session message is correct.
- Ensuring there is an activity message.

I made this out of my frustration with the Flow app synchronization with Apple Health, which you can read more on my [website](https://hacdias.com/2023/10/11/processing-bosch-ebike-flow-fit-files/). I will be updating this module as I see fit (pun intended). I am hopeful that Bosch will simply fix their own integration and that this workaround will no longer be necessary.

## Usage

Check it out at [hacdias.github.io/flowfit](https://hacdias.github.io/flowfit). It's web based and local first, no server needed. It uses Garmin's official [FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk).

## License

MIT © Henrique Dias
