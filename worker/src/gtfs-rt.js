/**
 * Self-contained GTFS-RT protobuf decoder
 * No external dependencies — works in Cloudflare Workers
 */

class PbfReader {
  constructor(buf) {
    this.buf = new Uint8Array(buf);
    this.pos = 0;
    this.length = this.buf.length;
  }

  readVarint() {
    let val = 0, shift = 0;
    while (this.pos < this.length) {
      const b = this.buf[this.pos++];
      val |= (b & 0x7F) << shift;
      if (b < 0x80) return val >>> 0;
      shift += 7;
    }
    return val >>> 0;
  }

  readSVarint() {
    const val = this.readVarint();
    return (val >>> 1) ^ -(val & 1);
  }

  readFloat() {
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getFloat32(0, true);
  }

  readBoolean() {
    return this.readVarint() !== 0;
  }

  readString() {
    const len = this.readVarint();
    const str = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return str;
  }

  readBytes() {
    const len = this.readVarint();
    const bytes = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return bytes;
  }

  readTag() {
    if (this.pos >= this.length) return 0;
    return this.readVarint();
  }

  skip(wireType) {
    switch (wireType) {
      case 0: this.readVarint(); break;
      case 1: this.pos += 8; break;
      case 2: { const len = this.readVarint(); this.pos += len; break; }
      case 5: this.pos += 4; break;
      default: throw new Error(`Unknown wire type: ${wireType}`);
    }
  }
}

function readStopTimeEvent(reader, end) {
  const obj = { delay: 0, time: 0, uncertainty: 0 };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.delay = reader.readSVarint(); break;
      case 2: obj.time = reader.readVarint(); break;
      case 3: obj.uncertainty = reader.readVarint(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readStopTimeUpdate(reader, end) {
  const obj = { stopSequence: 0, stopId: '', arrival: null, departure: null };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.stopSequence = reader.readVarint(); break;
      case 2: { const e = reader.readVarint() + reader.pos; obj.arrival = readStopTimeEvent(reader, e); break; }
      case 3: { const e = reader.readVarint() + reader.pos; obj.departure = readStopTimeEvent(reader, e); break; }
      case 4: obj.stopId = reader.readString(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readTrip(reader, end) {
  const obj = { tripId: '', startTime: '', startDate: '', routeId: '', directionId: 0 };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.tripId = reader.readString(); break;
      case 2: obj.startTime = reader.readString(); break;
      case 3: obj.startDate = reader.readString(); break;
      case 5: obj.routeId = reader.readString(); break;
      case 6: obj.directionId = reader.readVarint(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readVehicle(reader, end) {
  const obj = { id: '', label: '', licensePlate: '' };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.id = reader.readString(); break;
      case 2: obj.label = reader.readString(); break;
      case 3: obj.licensePlate = reader.readString(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readPosition(reader, end) {
  const obj = { latitude: 0, longitude: 0, bearing: 0, speed: 0 };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.latitude = reader.readFloat(); break;
      case 2: obj.longitude = reader.readFloat(); break;
      case 3: obj.bearing = reader.readFloat(); break;
      case 4: obj.speed = reader.readFloat(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readVehiclePosition(reader, end) {
  const obj = { trip: null, position: null, stopSequence: 0, stopId: '', timestamp: 0, vehicle: null };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: { const e = reader.readVarint() + reader.pos; obj.trip = readTrip(reader, e); break; }
      case 2: { const e = reader.readVarint() + reader.pos; obj.position = readPosition(reader, e); break; }
      case 3: obj.stopSequence = reader.readVarint(); break;
      case 4: reader.readVarint(); break;
      case 5: obj.timestamp = reader.readVarint(); break;
      case 7: obj.stopId = reader.readString(); break;
      case 8: { const e = reader.readVarint() + reader.pos; obj.vehicle = readVehicle(reader, e); break; }
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readTripUpdate(reader, end) {
  const obj = { trip: null, stopTimeUpdate: [], vehicle: null, timestamp: 0 };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: { const e = reader.readVarint() + reader.pos; obj.trip = readTrip(reader, e); break; }
      case 2: { const e = reader.readVarint() + reader.pos; obj.stopTimeUpdate.push(readStopTimeUpdate(reader, e)); break; }
      case 3: { const e = reader.readVarint() + reader.pos; obj.vehicle = readVehicle(reader, e); break; }
      case 4: obj.timestamp = reader.readVarint(); break;
      default: reader.skip(wire);
    }
  }
  return obj;
}

function readEntity(reader, end) {
  const obj = { id: '', isDeleted: false, tripUpdate: null, vehiclePosition: null };
  while (reader.pos < end) {
    const tag = reader.readTag();
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: obj.id = reader.readString(); break;
      case 2: obj.isDeleted = reader.readBoolean(); break;
      case 3: { const e = reader.readVarint() + reader.pos; obj.tripUpdate = readTripUpdate(reader, e); break; }
      case 4: { const e = reader.readVarint() + reader.pos; obj.vehiclePosition = readVehiclePosition(reader, e); break; }
      default: reader.skip(wire);
    }
  }
  return obj;
}

export function decodeFeedMessage(buffer) {
  const reader = new PbfReader(buffer);
  const feed = { timestamp: 0, entities: [] };

  while (reader.pos < reader.length) {
    const tag = reader.readTag();
    if (tag === 0) break;
    const field = tag >> 3;
    const wire = tag & 7;
    switch (field) {
      case 1: {
        const end = reader.readVarint() + reader.pos;
        while (reader.pos < end) {
          const htag = reader.readTag();
          const hfield = htag >> 3;
          const hwire = htag & 7;
          switch (hfield) {
            case 2: feed.timestamp = reader.readVarint(); break;
            default: reader.skip(hwire);
          }
        }
        break;
      }
      case 2: {
        const end = reader.readVarint() + reader.pos;
        feed.entities.push(readEntity(reader, end));
        break;
      }
      default: reader.skip(wire);
    }
  }
  return feed;
}
