# Many Times - Multi-location clock

## 24 hours, multiple-location clock UI

The primary UI element is the circle representing 24 hours. The circle is rotated so the current time on the 24 hours scale is at the top. Around the ring will be various points of interest, being individuals with known locations, or a location with a single time zone (cities or small countries). Above the circle will have three lines of text:

1. Fixed text, "It is currently"
2. Large, bold text - The current time in the user's timezone
3. "in|for " + Smaller text, possible wrapping - The current date in the user's timezone

Selecting a point of interest will rotate the circle and all outer labels so that the current time in the selected location is at the top. The text above the circle will change to:

1. Fixed text, "It is currently"
2. Large, bold text - The current time for the selected point of interest
3. "in|for " + Smaller text, possible wrapping - The current date for the selected point of interest

A line will extend from the centre of the circle to the current time for the user, and another line will extend from the centre of the circle to the current time for the selected point of interest.

### Phase 1 Functions

- locationLookup(name)
  - returns `[name, { lat, long }][]`
- currentLocation()
  - returns `[name, { lat, long }]`
- timeInLocation({ lat, long })
  - returns `[timestamp, timezone]`
- angleForLocation({ lat, long }, radOrDeg)
  - returns `rotationInRadOrDeg`
- timeOffsetForLocation({ lat, long })
  - returns `seconds`
- angleForTimeOffset(seconds, radOrDeg)
  - returns `rotationInRadOrDeg`

## 24 hours sky view

In the circle, a thick band with a conical gradient will represent the day/night cycle. The band will be rotated with the ring so that the current time is at the top. The colour at any given point on the band will represent as a best guess for the colour of the sky at that time and date at the selected location's latitude and longitude.

### Named colour stops

- Local midnight
- Astronomical night
- Astronomical dawn
- Nautical dawn
- Civil dawn
- Sunrise
- Morning golden hour
- Mid-morning
- Solar noon
- Mid-afternoon
- Afternoon golden hour
- Sunset
- Civil dusk
- Nautical dusk
- Astronomical dusk
- Late night
- Local midnight

### First-order factors affecting position and colour of colour stops

- Latitude
- Longitude
- Date
- Time

### Second-order factors affecting position and colour of colour stops

- altitude
- turbidity/aerosols
- humidity
- cloud_fraction
- ozone_factor
- light_pollution

### Phase 2 Functions

- skyColourForLocation
  - returns [colourStops, rotationInRadOrDeg]
- skyColourForLocationAndTime
  - returns [colourStops, rotationInRadOrDeg]
