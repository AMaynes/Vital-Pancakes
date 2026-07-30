/**
 * Pure rigid-body joint helpers for grouped Visual Board artwork.
 */

import {
  distanceBetween,
  getObjectBounds,
  getObjectSegments,
} from "./visual-board-geometry.mjs";
import {
  getObjectGroupIds,
  objectBelongsToGroup,
  transformSelectionObjects,
} from "./visual-board-groups.mjs?v=4";

export function createEmptyRig() {
  return { bodies: [], joints: [] };
}

export function normalizeRig(rawRig, objects = null) {
  const sourceBodies = Array.isArray(rawRig?.bodies) ? rawRig.bodies : [];
  const sourceJoints = Array.isArray(rawRig?.joints) ? rawRig.joints : [];
  const currentGroups = Array.isArray(objects)
    ? new Set(objects.flatMap(getObjectGroupIds))
    : null;
  const bodies = sourceBodies
    .filter((body) => (
      typeof body?.id === "string"
      && body.id
      && (!currentGroups || currentGroups.has(body.id))
    ))
    .map((body) => ({
      id: body.id,
      objectIds: Array.isArray(objects)
        ? objects
          .filter((object) => objectBelongsToGroup(object, body.id))
          .map((object) => object.id)
        : uniqueStrings(body.objectIds),
      jointIds: [],
      dimensionsLocked: Boolean(body.dimensionsLocked),
    }));
  const bodyIds = new Set(bodies.map((body) => body.id));
  const joints = sourceJoints
    .map((joint) => ({
      id: typeof joint?.id === "string" && joint.id ? joint.id : null,
      x: Number(joint?.x),
      y: Number(joint?.y),
      bodyIds: uniqueStrings(joint?.bodyIds).filter((bodyId) => bodyIds.has(bodyId)),
    }))
    .filter((joint) => (
      joint.id
      && Number.isFinite(joint.x)
      && Number.isFinite(joint.y)
      && joint.bodyIds.length >= 2
    ));
  const validJointIds = new Set(joints.map((joint) => joint.id));
  bodies.forEach((body) => {
    body.jointIds = joints
      .filter((joint) => joint.bodyIds.includes(body.id))
      .map((joint) => joint.id)
      .filter((jointId) => validJointIds.has(jointId));
  });
  return { bodies, joints };
}

export function createSharedGroupJoints(
  selectionUnits,
  sourceRig,
  createIdentifier,
  tolerance = 24,
) {
  if (!Array.isArray(selectionUnits) || selectionUnits.length < 2) {
    return { rig: normalizeRig(sourceRig), addedJoints: [] };
  }
  if (typeof createIdentifier !== "function") {
    return { rig: normalizeRig(sourceRig), addedJoints: [] };
  }

  const units = selectionUnits
    .map((objects) => ({
      id: getUnitGroupId(objects),
      objects: Array.isArray(objects) ? objects : [],
    }))
    .filter((unit) => unit.id && unit.objects.length);
  if (units.length < 2) return { rig: normalizeRig(sourceRig), addedJoints: [] };

  const rig = normalizeRig(sourceRig);
  units.forEach((unit) => ensureBody(rig, unit));
  const addedJoints = [];
  for (let firstIndex = 0; firstIndex < units.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < units.length; secondIndex += 1) {
      const first = units[firstIndex];
      const second = units[secondIndex];
      const pairIds = [first.id, second.id].sort();
      const existing = rig.joints.find((joint) => (
        joint.bodyIds.length === 2
        && [...joint.bodyIds].sort().every((bodyId, index) => bodyId === pairIds[index])
      ));
      if (existing) continue;

      const point = findSharedGroupPoint(
        first.objects,
        second.objects,
        Math.max(0, tolerance),
      );
      if (!point) continue;
      const joint = {
        id: createIdentifier(),
        x: point.x,
        y: point.y,
        bodyIds: [first.id, second.id],
      };
      rig.joints.push(joint);
      rig.bodies
        .filter((body) => joint.bodyIds.includes(body.id))
        .forEach((body) => body.jointIds.push(joint.id));
      addedJoints.push(joint);
    }
  }
  return { rig, addedJoints };
}

export function findSharedGroupPoint(firstObjects, secondObjects, tolerance = 24) {
  if (!firstObjects?.length || !secondObjects?.length) return null;
  const firstSegments = firstObjects.flatMap(getVisibleSegments);
  const secondSegments = secondObjects.flatMap(getVisibleSegments);
  if (firstSegments.length && secondSegments.length) {
    let closest = null;
    firstSegments.forEach((firstSegment) => {
      secondSegments.forEach((secondSegment) => {
        const candidate = getClosestSegmentContact(firstSegment, secondSegment);
        if (!closest || candidate.distance < closest.distance) closest = candidate;
      });
    });
    if (!closest || closest.distance > tolerance) return null;
    return {
      x: (closest.first.x + closest.second.x) / 2,
      y: (closest.first.y + closest.second.y) / 2,
    };
  }

  const overlap = getBoundsOverlap(
    getCombinedBounds(firstObjects),
    getCombinedBounds(secondObjects),
  );
  return overlap
    ? {
      x: overlap.x + overlap.width / 2,
      y: overlap.y + overlap.height / 2,
    }
    : null;
}

export function getRigJointsForBodyIds(rig, bodyIds) {
  const selectedIds = new Set(bodyIds);
  return (rig?.joints ?? []).filter((joint) => (
    joint.bodyIds.some((bodyId) => selectedIds.has(bodyId))
  ));
}

export function getConnectedRigBodyIds(rig, startingBodyIds) {
  const connected = new Set(startingBodyIds);
  let changed = true;
  while (changed) {
    changed = false;
    (rig?.joints ?? []).forEach((joint) => {
      if (!joint.bodyIds.some((bodyId) => connected.has(bodyId))) return;
      joint.bodyIds.forEach((bodyId) => {
        if (connected.has(bodyId)) return;
        connected.add(bodyId);
        changed = true;
      });
    });
  }
  return connected;
}

export function setRigBodyDimensionLock(rig, bodyIds, locked) {
  const selectedIds = new Set(bodyIds);
  return {
    bodies: (rig?.bodies ?? []).map((body) => (
      selectedIds.has(body.id)
        ? { ...body, dimensionsLocked: Boolean(locked) }
        : cloneValue(body)
    )),
    joints: cloneValue(rig?.joints ?? []),
  };
}

export function removeRigBodies(rig, bodyIds) {
  const removedIds = new Set(bodyIds);
  const bodies = (rig?.bodies ?? [])
    .filter((body) => !removedIds.has(body.id))
    .map(cloneValue);
  const joints = (rig?.joints ?? [])
    .map((joint) => ({
      ...cloneValue(joint),
      bodyIds: joint.bodyIds.filter((bodyId) => !removedIds.has(bodyId)),
    }))
    .filter((joint) => joint.bodyIds.length >= 2);
  const validJointIds = new Set(joints.map((joint) => joint.id));
  bodies.forEach((body) => {
    body.jointIds = body.jointIds.filter((jointId) => validJointIds.has(jointId));
  });
  return { bodies, joints };
}

export function resolveConstrainedPoint(target, original, constraints) {
  const usableConstraints = deduplicateConstraints(constraints);
  if (!usableConstraints.length) return { ...target };
  if (usableConstraints.length === 1) {
    return projectToCircle(target, usableConstraints[0], original);
  }

  const candidates = [];
  for (let firstIndex = 0; firstIndex < usableConstraints.length - 1; firstIndex += 1) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < usableConstraints.length;
      secondIndex += 1
    ) {
      candidates.push(...getCircleIntersections(
        usableConstraints[firstIndex],
        usableConstraints[secondIndex],
      ));
    }
  }
  if (satisfiesConstraints(original, usableConstraints)) candidates.push({ ...original });
  const exactCandidates = candidates.filter((point) => (
    satisfiesConstraints(point, usableConstraints)
  ));
  if (!exactCandidates.length) return { ...original };
  return exactCandidates.reduce((closest, point) => (
    distanceBetween(point, target) < distanceBetween(closest, target) ? point : closest
  ));
}

export function dragRigJoint(sourceObjects, sourceRig, jointId, target) {
  const objects = cloneValue(sourceObjects ?? []);
  const rig = cloneValue(sourceRig ?? createEmptyRig());
  const joint = rig.joints.find((candidate) => candidate.id === jointId);
  if (!joint) return { objects, rig, point: null };

  const originalPoint = { x: joint.x, y: joint.y };
  const jointsById = new Map(rig.joints.map((candidate) => [candidate.id, candidate]));
  const attachedBodies = rig.bodies.filter((body) => joint.bodyIds.includes(body.id));
  const constraints = attachedBodies
    .filter((body) => body.dimensionsLocked)
    .flatMap((body) => body.jointIds
      .filter((candidateId) => candidateId !== jointId)
      .map((candidateId) => jointsById.get(candidateId))
      .filter(Boolean)
      .map((otherJoint) => ({
        x: otherJoint.x,
        y: otherJoint.y,
        radius: distanceBetween(originalPoint, otherJoint),
      })));
  const point = resolveConstrainedPoint(target, originalPoint, constraints);
  const replacements = new Map();

  attachedBodies.forEach((body) => {
    const bodyObjects = objects.filter((object) => objectBelongsToGroup(object, body.id));
    if (!bodyObjects.length) return;
    const otherJoints = body.jointIds
      .filter((candidateId) => candidateId !== jointId)
      .map((candidateId) => jointsById.get(candidateId))
      .filter(Boolean)
      .sort((first, second) => (
        distanceBetween(originalPoint, first) - distanceBetween(originalPoint, second)
      ));
    if (!otherJoints.length) {
      const translated = transformSelectionObjects(bodyObjects, originalPoint, {
        translation: {
          x: point.x - originalPoint.x,
          y: point.y - originalPoint.y,
        },
      });
      translated.forEach((object) => replacements.set(object.id, object));
      return;
    }

    const anchor = otherJoints[0];
    const originalAngle = Math.atan2(
      originalPoint.y - anchor.y,
      originalPoint.x - anchor.x,
    );
    const nextAngle = Math.atan2(point.y - anchor.y, point.x - anchor.x);
    const originalDistance = Math.max(1e-9, distanceBetween(originalPoint, anchor));
    const nextDistance = distanceBetween(point, anchor);
    const transformed = transformSelectionObjects(bodyObjects, anchor, {
      scale: body.dimensionsLocked ? 1 : nextDistance / originalDistance,
      rotation: nextAngle - originalAngle,
    });
    transformed.forEach((object) => replacements.set(object.id, object));
  });

  joint.x = point.x;
  joint.y = point.y;
  return {
    objects: objects.map((object) => replacements.get(object.id) ?? object),
    rig,
    point,
  };
}

function ensureBody(rig, unit) {
  const existing = rig.bodies.find((body) => body.id === unit.id);
  if (existing) {
    existing.objectIds = unit.objects.map((object) => object.id);
    return existing;
  }
  const body = {
    id: unit.id,
    objectIds: unit.objects.map((object) => object.id),
    jointIds: [],
    dimensionsLocked: false,
  };
  rig.bodies.push(body);
  return body;
}

function getUnitGroupId(objects) {
  if (!Array.isArray(objects) || !objects.length) return null;
  const groupId = objects[0]?.groupId;
  return typeof groupId === "string"
    && groupId
    && objects.every((object) => object.groupId === groupId)
    ? groupId
    : null;
}

function getCombinedBounds(objects) {
  const segmentPoints = objects
    .flatMap(getVisibleSegments)
    .flat();
  if (segmentPoints.length) {
    const xValues = segmentPoints.map((point) => point.x);
    const yValues = segmentPoints.map((point) => point.y);
    const left = Math.min(...xValues);
    const top = Math.min(...yValues);
    const right = Math.max(...xValues);
    const bottom = Math.max(...yValues);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  const bounds = objects.map(getObjectBounds);
  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function getBoundsOverlap(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right < left || bottom < top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function getVisibleSegments(object) {
  if (object.type === "pen") {
    return (object.points ?? []).slice(1).map((end, index) => [
      object.points[index],
      end,
    ]);
  }
  return getObjectSegments(object);
}

function getClosestSegmentContact(firstSegment, secondSegment) {
  const intersection = getSegmentIntersection(firstSegment, secondSegment);
  if (intersection) {
    return {
      first: intersection,
      second: intersection,
      distance: 0,
    };
  }
  const candidates = [
    getEndpointProjection(firstSegment[0], secondSegment),
    getEndpointProjection(firstSegment[1], secondSegment),
    reverseContact(getEndpointProjection(secondSegment[0], firstSegment)),
    reverseContact(getEndpointProjection(secondSegment[1], firstSegment)),
  ];
  return candidates.reduce((closest, candidate) => (
    candidate.distance < closest.distance ? candidate : closest
  ));
}

function getSegmentIntersection(firstSegment, secondSegment) {
  const [firstStart, firstEnd] = firstSegment;
  const [secondStart, secondEnd] = secondSegment;
  const firstDelta = {
    x: firstEnd.x - firstStart.x,
    y: firstEnd.y - firstStart.y,
  };
  const secondDelta = {
    x: secondEnd.x - secondStart.x,
    y: secondEnd.y - secondStart.y,
  };
  const denominator = firstDelta.x * secondDelta.y - firstDelta.y * secondDelta.x;
  const betweenStarts = {
    x: secondStart.x - firstStart.x,
    y: secondStart.y - firstStart.y,
  };
  if (Math.abs(denominator) <= 1e-12) {
    const collinear = Math.abs(
      betweenStarts.x * firstDelta.y - betweenStarts.y * firstDelta.x,
    ) <= 1e-9;
    const lengthSquared = firstDelta.x * firstDelta.x + firstDelta.y * firstDelta.y;
    if (!collinear || lengthSquared <= 1e-12) return null;
    const secondStartProgress = (
      betweenStarts.x * firstDelta.x + betweenStarts.y * firstDelta.y
    ) / lengthSquared;
    const betweenEnds = {
      x: secondEnd.x - firstStart.x,
      y: secondEnd.y - firstStart.y,
    };
    const secondEndProgress = (
      betweenEnds.x * firstDelta.x + betweenEnds.y * firstDelta.y
    ) / lengthSquared;
    const overlapStart = Math.max(0, Math.min(secondStartProgress, secondEndProgress));
    const overlapEnd = Math.min(1, Math.max(secondStartProgress, secondEndProgress));
    if (overlapEnd < overlapStart - 1e-9) return null;
    const midpointProgress = (overlapStart + overlapEnd) / 2;
    return {
      x: firstStart.x + firstDelta.x * midpointProgress,
      y: firstStart.y + firstDelta.y * midpointProgress,
    };
  }
  const firstProgress = (
    betweenStarts.x * secondDelta.y - betweenStarts.y * secondDelta.x
  ) / denominator;
  const secondProgress = (
    betweenStarts.x * firstDelta.y - betweenStarts.y * firstDelta.x
  ) / denominator;
  if (
    firstProgress < -1e-9
    || firstProgress > 1 + 1e-9
    || secondProgress < -1e-9
    || secondProgress > 1 + 1e-9
  ) return null;
  return {
    x: firstStart.x + firstDelta.x * clamp(firstProgress, 0, 1),
    y: firstStart.y + firstDelta.y * clamp(firstProgress, 0, 1),
  };
}

function getEndpointProjection(point, segment) {
  const [start, end] = segment;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const progress = lengthSquared
    ? clamp(
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
      0,
      1,
    )
    : 0;
  const projection = {
    x: start.x + deltaX * progress,
    y: start.y + deltaY * progress,
  };
  return {
    first: point,
    second: projection,
    distance: distanceBetween(point, projection),
  };
}

function reverseContact(contact) {
  return {
    first: contact.second,
    second: contact.first,
    distance: contact.distance,
  };
}

function deduplicateConstraints(constraints) {
  const unique = [];
  (Array.isArray(constraints) ? constraints : []).forEach((constraint) => {
    const normalized = {
      x: Number(constraint?.x),
      y: Number(constraint?.y),
      radius: Math.max(0, Number(constraint?.radius)),
    };
    if (![normalized.x, normalized.y, normalized.radius].every(Number.isFinite)) return;
    if (unique.some((candidate) => (
      distanceBetween(candidate, normalized) <= 1e-7
      && Math.abs(candidate.radius - normalized.radius) <= 1e-7
    ))) return;
    unique.push(normalized);
  });
  return unique;
}

function projectToCircle(target, circle, fallback) {
  const deltaX = target.x - circle.x;
  const deltaY = target.y - circle.y;
  const length = Math.hypot(deltaX, deltaY);
  if (circle.radius === 0) return { x: circle.x, y: circle.y };
  if (length <= 1e-12) {
    const fallbackAngle = Math.atan2(fallback.y - circle.y, fallback.x - circle.x);
    return {
      x: circle.x + Math.cos(fallbackAngle) * circle.radius,
      y: circle.y + Math.sin(fallbackAngle) * circle.radius,
    };
  }
  return {
    x: circle.x + deltaX / length * circle.radius,
    y: circle.y + deltaY / length * circle.radius,
  };
}

function getCircleIntersections(first, second) {
  const centerDistance = distanceBetween(first, second);
  if (centerDistance <= 1e-12) return [];
  if (centerDistance > first.radius + second.radius + 1e-7) return [];
  if (centerDistance < Math.abs(first.radius - second.radius) - 1e-7) return [];

  const along = (
    first.radius * first.radius
    - second.radius * second.radius
    + centerDistance * centerDistance
  ) / (2 * centerDistance);
  const heightSquared = Math.max(0, first.radius * first.radius - along * along);
  const height = Math.sqrt(heightSquared);
  const directionX = (second.x - first.x) / centerDistance;
  const directionY = (second.y - first.y) / centerDistance;
  const base = {
    x: first.x + directionX * along,
    y: first.y + directionY * along,
  };
  if (height <= 1e-9) return [base];
  return [
    {
      x: base.x - directionY * height,
      y: base.y + directionX * height,
    },
    {
      x: base.x + directionY * height,
      y: base.y - directionX * height,
    },
  ];
}

function satisfiesConstraints(point, constraints) {
  return constraints.every((constraint) => (
    Math.abs(distanceBetween(point, constraint) - constraint.radius)
    <= Math.max(1e-5, constraint.radius * 1e-6)
  ));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value))];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cloneValue(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
