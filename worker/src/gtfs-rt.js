/**
 * Lightweight GTFS-RT protobuf decoder for Cloudflare Workers
 * Uses the 'pbf' library (~3KB) instead of heavy protobufjs
 */
import Pbf from 'pbf';

// ─── StopTimeEvent ──────────────────────────────────────
function readStopTimeEvent(pbf, end) {
  const obj = { delay: 0, time: 0, uncertainty: 0 };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.delay = pbf.readSVarint(); break;
      case 2: obj.time = pbf.readVarint(); break;
      case 3: obj.uncertainty = pbf.readVarint(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── StopTimeUpdate ─────────────────────────────────────
function readStopTimeUpdate(pbf, end) {
  const obj = { stopSequence: 0, stopId: '', arrival: null, departure: null };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.stopSequence = pbf.readVarint(); break;
      case 2: { const e = pbf.readVarint() + pbf.pos; obj.arrival = readStopTimeEvent(pbf, e); break; }
      case 3: { const e = pbf.readVarint() + pbf.pos; obj.departure = readStopTimeEvent(pbf, e); break; }
      case 4: obj.stopId = pbf.readString(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── TripDescriptor ─────────────────────────────────────
function readTrip(pbf, end) {
  const obj = { tripId: '', startTime: '', startDate: '', routeId: '', directionId: 0 };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.tripId = pbf.readString(); break;
      case 2: obj.startTime = pbf.readString(); break;
      case 3: obj.startDate = pbf.readString(); break;
      case 5: obj.routeId = pbf.readString(); break;
      case 6: obj.directionId = pbf.readVarint(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── VehicleDescriptor ──────────────────────────────────
function readVehicle(pbf, end) {
  const obj = { id: '', label: '', licensePlate: '' };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.id = pbf.readString(); break;
      case 2: obj.label = pbf.readString(); break;
      case 3: obj.licensePlate = pbf.readString(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── Position ───────────────────────────────────────────
function readPosition(pbf, end) {
  const obj = { latitude: 0, longitude: 0, bearing: 0, speed: 0 };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.latitude = pbf.readFloat(); break;
      case 2: obj.longitude = pbf.readFloat(); break;
      case 3: obj.bearing = pbf.readFloat(); break;
      case 4: obj.speed = pbf.readFloat(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── VehiclePosition ────────────────────────────────────
function readVehiclePosition(pbf, end) {
  const obj = { trip: null, position: null, stopSequence: 0, stopId: '', timestamp: 0, vehicle: null };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: { const e = pbf.readVarint() + pbf.pos; obj.trip = readTrip(pbf, e); break; }
      case 2: { const e = pbf.readVarint() + pbf.pos; obj.position = readPosition(pbf, e); break; }
      case 3: obj.stopSequence = pbf.readVarint(); break;
      case 4: pbf.readVarint(); break; // current_status enum
      case 5: obj.timestamp = pbf.readVarint(); break;
      case 7: obj.stopId = pbf.readString(); break;
      case 8: { const e = pbf.readVarint() + pbf.pos; obj.vehicle = readVehicle(pbf, e); break; }
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── TripUpdate ─────────────────────────────────────────
function readTripUpdate(pbf, end) {
  const obj = { trip: null, stopTimeUpdate: [], vehicle: null, timestamp: 0 };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: { const e = pbf.readVarint() + pbf.pos; obj.trip = readTrip(pbf, e); break; }
      case 2: { const e = pbf.readVarint() + pbf.pos; obj.stopTimeUpdate.push(readStopTimeUpdate(pbf, e)); break; }
      case 3: { const e = pbf.readVarint() + pbf.pos; obj.vehicle = readVehicle(pbf, e); break; }
      case 4: obj.timestamp = pbf.readVarint(); break;
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── FeedEntity ─────────────────────────────────────────
function readEntity(pbf, end) {
  const obj = { id: '', isDeleted: false, tripUpdate: null, vehiclePosition: null };
  while (pbf.pos < end) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: obj.id = pbf.readString(); break;
      case 2: obj.isDeleted = pbf.readBoolean(); break;
      case 3: { const e = pbf.readVarint() + pbf.pos; obj.tripUpdate = readTripUpdate(pbf, e); break; }
      case 4: { const e = pbf.readVarint() + pbf.pos; obj.vehiclePosition = readVehiclePosition(pbf, e); break; }
      case 5: pbf.skip(tag & 7); break; // alert - skip for now
      default: pbf.skip(tag & 7);
    }
  }
  return obj;
}

// ─── FeedMessage (entry point) ──────────────────────────
export function decodeFeedMessage(buffer) {
  const pbf = new Pbf(new Uint8Array(buffer));
  const feed = { timestamp: 0, entities: [] };

  while (pbf.pos < pbf.length) {
    const tag = pbf.readTag();
    switch (tag >> 3) {
      case 1: {
        // FeedHeader
        const end = pbf.readVarint() + pbf.pos;
        while (pbf.pos < end) {
          const htag = pbf.readTag();
          switch (htag >> 3) {
            case 2: feed.timestamp = pbf.readVarint(); break;
            default: pbf.skip(htag & 7);
          }
        }
        break;
      }
      case 2: {
        const end = pbf.readVarint() + pbf.pos;
        feed.entities.push(readEntity(pbf, end));
        break;
      }
      default: pbf.skip(tag & 7);
    }
  }
  return feed;
}
