#!/usr/bin/env blender --background --python
"""
Generates the brass altar furniture for the room as PNGs with alpha.

    blender -b -P tools/altar-assets.py -- --out static/images/altar
    blender -b -P tools/altar-assets.py -- --only nilavilakku

Why Blender rather than downloaded stock art: every object here is a
lathe-turned brass piece, i.e. a profile curve spun about an axis, which is
literally how it is made in a workshop. And rendering them ourselves means one
shared light rig across all of them, so they composite into a single coherent
altar instead of reading as cut-out stickers.

LIGHTING CONVENTION — every object is lit as if the centre of the altar lies
to its RIGHT. So a rendered lamp is placed on the LEFT of the composition, and
the right-hand lamp is the same PNG mirrored in CSS: the flip puts its key
light back on the inward side. Shadows therefore fall away from centre.

DOWNSTREAM COUPLING — the web side hardcodes positions derived from this
script's camera. Changing a profile, TILT_DEG or ORTHO_MARGIN silently
invalidates them; the flames drift off the wicks with no error. The three
sites and the re-derivation formula are documented at WICKS in
src/components/altar.ts. Update them in the same commit as a re-render.
"""

import argparse
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blender_common import (  # noqa: E402
    ORTHO_MARGIN,
    TILT_DEG,
    add_area,
    build_camera,
    build_world,
    clear_scene,
    configure_render,
    downscale,
    ensure_dir,
    join_all,
    make_object,
    report_content_box,
    report_projection,
)

TAG = "altar-assets"

# Height of the longest edge of each render, in pixels, at 3x.
RENDER_LONG_EDGE_3X = 1536
SAMPLES = 160

# Angle of the first wick-bearing arm, measured from +x. 90 deg points straight
# away from the camera, and five-fold symmetry has a mirror plane through each
# arm, so this is the one orientation that reads symmetrically head-on: one
# wick at the back, two at the sides, two at the front. Shared by the
# nilavilakku's lotus lips and the arati lamp's arms so they look like a set.
ARM_PHASE = 90.0


# ---------------------------------------------------------------------------
# Lathe
# ---------------------------------------------------------------------------


def revolve(name, profile, segments=128, lobes=None):
    """Build a surface of revolution.

    profile: [(radius, z)] ordered bottom to top. A radius of 0 at either end
             becomes a pole (single vertex) rather than a degenerate ring.
    lobes:   optional (count, amplitude, z_start, z_end, phase_deg) to scallop
             the radius by cos(count * theta - phase), faded in across the z
             range. This is how the lamp's lotus-petal oil dish is made — one
             construction rather than modelling and arraying separate petals.
             The phase orients the lobes relative to the camera.
    """
    verts = []
    # ring_index[i] is either ('pole', vert) or ('ring', first_vert_index)
    rings = []

    for radius, z in profile:
        if radius <= 1e-6:
            rings.append(("pole", len(verts)))
            verts.append((0.0, 0.0, z))
            continue

        start = len(verts)
        for j in range(segments):
            theta = 2.0 * math.pi * j / segments
            r = radius
            if lobes:
                count, amp, z0, z1, phase_deg = lobes
                if z0 <= z <= z1:
                    blend = (z - z0) / max(z1 - z0, 1e-6)
                    # Ease in so the scallop grows out of the round bowl.
                    blend = blend * blend
                    r *= 1.0 + amp * blend * math.cos(
                        count * theta - math.radians(phase_deg)
                    )
            verts.append((r * math.cos(theta), r * math.sin(theta), z))
        rings.append(("ring", start))

    faces = []
    for i in range(len(rings) - 1):
        kind_a, a = rings[i]
        kind_b, b = rings[i + 1]
        for j in range(segments):
            k = (j + 1) % segments
            if kind_a == "pole" and kind_b == "ring":
                faces.append((a, b + j, b + k))
            elif kind_a == "ring" and kind_b == "pole":
                faces.append((a + j, b, a + k))
            elif kind_a == "ring" and kind_b == "ring":
                faces.append((a + j, a + k, b + k, b + j))

    return make_object(name, verts, faces)


def sweep(name, path, radii, theta, sides=14, squash=0.42):
    """Sweep a tube along a planar (radius, z) path standing at angle theta.

    The cross-section is squashed across the path's own plane, so the result
    reads as a flat bent bracket seen edge-on rather than a length of pipe —
    which is what the arati lamp's arms are: cut and bent sheet brass.

    The path is planar by construction, so the frame needs no parallel
    transport: the out-of-plane axis is the horizontal tangent at theta, and
    the in-plane normal falls out of the cross product with it.
    """
    ct, st = math.cos(theta), math.sin(theta)
    ux, uy, uz = -st, ct, 0.0

    verts, rings = [], []
    n = len(path)
    for i, (r, z) in enumerate(path):
        r0, z0 = path[max(i - 1, 0)]
        r1, z1 = path[min(i + 1, n - 1)]
        dr, dz = r1 - r0, z1 - z0
        length = math.hypot(dr, dz) or 1.0
        dr, dz = dr / length, dz / length

        # tangent, then in-plane normal = tangent x out-of-plane
        tx, ty, tz = dr * ct, dr * st, dz
        vx = ty * uz - tz * uy
        vy = tz * ux - tx * uz
        vz = tx * uy - ty * ux

        cx, cy, cz = r * ct, r * st, z
        rad = radii[i]
        rings.append(len(verts))
        for j in range(sides):
            a = 2.0 * math.pi * j / sides
            ca, sa = math.cos(a), math.sin(a)
            verts.append(
                (
                    cx + rad * (ca * vx + squash * sa * ux),
                    cy + rad * (ca * vy + squash * sa * uy),
                    cz + rad * (ca * vz + squash * sa * uz),
                )
            )

    faces = []
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(sides):
            k = (j + 1) % sides
            faces.append((a + j, a + k, b + k, b + j))

    for end, ring in ((0, rings[0]), (-1, rings[-1])):
        r, z = path[end]
        centre = len(verts)
        verts.append((r * ct, r * st, z))
        for j in range(sides):
            k = (j + 1) % sides
            faces.append(
                (centre, ring + k, ring + j)
                if end == 0
                else (centre, ring + j, ring + k)
            )

    return make_object(name, verts, faces)


def bulb(points, r_neck, r_max, z0, height, steps=10):
    """Append a turned swelling to a profile: neck, belly, neck."""
    for i in range(steps + 1):
        t = i / steps
        r = r_neck + (r_max - r_neck) * math.sin(t * math.pi) ** 0.8
        points.append((r, z0 + height * t))


def bezier(p0, p1, p2, p3, steps):
    """Cubic Bezier in the (radius, z) plane, for profiles a lathe can't make.

    The arati lamp's arms leave the stem heading outward and arrive at the cup
    heading straight up. Two straight runs meeting at a corner read as bent
    pipe; the control points let the turn happen as one continuous sweep.
    """
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        w = (u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t)
        out.append(
            tuple(
                sum(w[k] * pt[axis] for k, pt in enumerate((p0, p1, p2, p3)))
                for axis in (0, 1)
            )
        )
    return out


def collar(points, r_in, r_out, z0, height):
    """Append a sharp turned ring — the crisp step between smooth sections."""
    points.append((r_in, z0))
    points.append((r_out, z0 + height * 0.25))
    points.append((r_out, z0 + height * 0.75))
    points.append((r_in, z0 + height))


def blob(name, scale, location, rotation=(0.0, 0.0, 0.0), segments=24, rings=14):
    """A sphere, scaled and placed.

    The Nandi on the bell's handle is the one thing in this file that was never
    turned on a lathe — it is cast, so it is modelled the way a figure is
    roughed out, from a handful of ellipsoids. Object transforms are enough
    because join_all bakes them in, the same thing the arati lamp's cups rely
    on.
    """
    p = []
    for i in range(rings + 1):
        a = math.pi * i / rings
        p.append((math.sin(a), -math.cos(a)))
    obj = revolve(name, p, segments=segments)
    obj.scale = scale
    obj.rotation_euler = rotation
    obj.location = location
    return obj


def spike(name, r0, height, location, rotation=(0.0, 0.0, 0.0), segments=12, steps=8):
    """A tapering horn, standing on +z before it is rotated into place."""
    p = [(0.0, 0.0), (r0, 0.0)]
    for i in range(1, steps):
        t = i / steps
        p.append((r0 * (1.0 - t) ** 0.85, height * t))
    p.append((0.0, height))
    obj = revolve(name, p, segments=segments)
    obj.rotation_euler = rotation
    obj.location = location
    return obj


# ---------------------------------------------------------------------------
# Objects
# ---------------------------------------------------------------------------


def build_nilavilakku():
    """The tall Kerala standing lamp — flared base, turned stem, lotus dish."""
    p = []

    # Stepped, flaring base. Kept narrow — the whole point of this lamp is that
    # it is tall and slender, roughly 1:4.5 width to height.
    p += [
        (0.00, 0.00),
        (1.00, 0.00),
        (1.00, 0.07),
        (0.92, 0.13),
        (0.95, 0.19),
        (0.87, 0.27),
    ]
    for i in range(1, 15):  # concave sweep up out of the base
        t = i / 14
        p.append((0.87 - 0.55 * math.sin(t * math.pi * 0.5), 0.27 + 1.20 * t))
    z = 1.47

    # Turned stem: six swellings, each a little slimmer than the one below.
    stem = [
        # (neck radius, belly radius, height)
        (0.26, 0.38, 0.92),
        (0.23, 0.35, 0.96),
        (0.21, 0.33, 0.96),
        (0.20, 0.31, 0.92),
        (0.19, 0.29, 0.88),
        (0.18, 0.27, 0.82),
    ]
    r_prev = 0.32
    for neck, belly, h in stem:
        collar(p, r_prev, r_prev + 0.09, z, 0.075)
        z += 0.075
        bulb(p, neck, belly, z, h)
        z += h
        r_prev = neck
    collar(p, r_prev, r_prev + 0.07, z, 0.07)
    z += 0.07

    # Underside of the oil dish, flaring out.
    dish_z = z
    for i in range(1, 13):
        t = i / 12
        p.append((0.18 + 0.80 * t**0.6, dish_z + 0.40 * t))
    z = dish_z + 0.40

    # Rim turns up into the lotus lips that hold the wicks, then the bowl
    # floor drops back down and in toward the central shaft.
    p.append((1.02, z + 0.09))
    p.append((1.03, z + 0.17))
    p.append((0.96, z + 0.19))
    for i in range(1, 11):
        t = i / 10
        p.append((0.96 - 0.74 * t, z + 0.19 - 0.30 * math.sin(t * math.pi * 0.5)))
    z = z - 0.11

    # Central finial: a bulb, then a tapered spike.
    collar(p, 0.22, 0.32, z, 0.08)
    z += 0.08
    bulb(p, 0.20, 0.40, z, 0.66)
    z += 0.66
    collar(p, 0.16, 0.25, z, 0.07)
    z += 0.07
    for i in range(1, 15):
        t = i / 14
        p.append((0.19 * (1 - t) ** 1.5, z + 0.86 * t))
    p.append((0.0, z + 0.90))

    # 5-fold scallop across the rim, giving the lotus-petal lips in one
    # construction rather than modelling and arraying five separate spouts.
    #
    # The lobe phase is 5 * ARM_PHASE because cos(5*theta - phase) puts a crest
    # wherever 5*theta == phase.
    obj = revolve(
        "nilavilakku",
        p,
        segments=192,
        lobes=(5, 0.19, dish_z + 0.26, dish_z + 0.59, 5.0 * ARM_PHASE),
    )

    # A wick burns at the tip of each lip.
    flames = []
    for k in range(5):
        theta = math.radians(ARM_PHASE + 72.0 * k)
        flames.append((1.14 * math.cos(theta), 1.14 * math.sin(theta), dish_z + 0.72))
    return obj, flames, []


def build_incense():
    """A small brass boat-shaped holder — the source of the smoke column."""
    p = [
        (0.00, 0.00),
        (0.62, 0.00),
        (0.62, 0.05),
        (0.54, 0.09),
        (0.58, 0.14),
    ]
    for i in range(1, 9):  # waist, then out to the ash dish
        t = i / 8
        p.append((0.58 - 0.14 * math.sin(t * math.pi * 0.6), 0.14 + 0.20 * t))
    p.append((0.56, 0.40))
    p.append((0.50, 0.43))
    for i in range(1, 9):  # inner dish
        t = i / 8
        p.append((0.50 - 0.32 * t, 0.43 - 0.17 * math.sin(t * math.pi * 0.5)))

    # Central boss the stick is pushed into.
    z = 0.26
    collar(p, 0.18, 0.24, z, 0.05)
    z += 0.05
    p.append((0.11, z + 0.06))
    p.append((0.00, z + 0.09))

    obj = revolve("incense-holder", p, segments=128)
    return obj, [], []


def build_diya():
    """A small oil lamp for the ledge — shallow dish with a pinched lip."""
    p = [
        (0.00, 0.00),
        (0.42, 0.00),
        (0.46, 0.05),
        (0.60, 0.14),
        (0.78, 0.26),
        (0.86, 0.38),
        (0.88, 0.46),
        (0.82, 0.48),
    ]
    for i in range(1, 9):
        t = i / 8
        p.append((0.82 * (1 - t), 0.46 - 0.26 * math.sin(t * math.pi * 0.5)))

    # A single lobe pulls one side of the rim out into the wick spout.
    obj = revolve("diya", p, segments=128, lobes=(1, 0.30, 0.26, 0.48, 0.0))
    return obj, [(0.0, 0.0, 0.30)], []


def build_kalasha():
    """Brass water pot for the corners of the ledge."""
    p = [
        (0.00, 0.00),
        (0.62, 0.00),
        (0.62, 0.07),
        (0.56, 0.12),
    ]
    for i in range(1, 15):
        t = i / 14
        p.append((0.56 + 0.62 * math.sin(t * math.pi * 0.85), 0.12 + 1.05 * t))
    z = 1.17
    p.append((0.52, z))
    collar(p, 0.52, 0.66, z, 0.10)
    z += 0.10
    p.append((0.60, z + 0.14))
    p.append((0.66, z + 0.26))
    p.append((0.62, z + 0.30))
    for i in range(1, 7):
        t = i / 6
        p.append((0.58 * (1 - t), z + 0.28 - 0.10 * t))

    obj = revolve("kalasha", p, segments=128)
    return obj, [], []


# The arati lamp's five arms stand at the same angles as the nilavilakku's five
# lips (see ARM_PHASE), so head-on you read one cup at the back, two at the
# sides and two at the front — the two lamps are the same lamp at two scales,
# which is what makes them read as a set.
#
# Proportions are measured off docs/arati-lamp-1.jpg: the brass is very nearly
# as tall as the dish is wide, and the cups reach just past the dish rim.
ARATI_ARMS = 5
ARATI_DISH_R = 1.25
ARATI_ARM_R = 1.00
ARATI_ARM_Z = 0.86
ARATI_CUP_Z = 1.36


def build_arati():
    """Pancharati — the five-flame hand lamp waved before the deity.

    The one piece here that is not a single lathe-turned object: a turned dish
    and stem with five scrolled arms brazed on, each carrying a cup. So it is
    a revolve, plus five arms and five pendant volutes swept as flat brackets,
    plus five small revolved cups, joined into one mesh.

    Built with no handle. The reference photos all show it gripped by the dish
    rim itself, and a handle would give the lamp a front — the wrong property
    for something that gets picked up and waved through an arc.
    """
    # --- dish: a broad shallow thali with a turned-up rim ---
    # Nearly a flat cone rather than a bowl. A curved underside reads as a
    # serving bowl the moment it is seen from below the rim, which is exactly
    # the angle the camera tilt gives.
    p = [
        (0.00, 0.00),
        (0.36, 0.00),
        (0.40, 0.025),
        (0.42, 0.05),
    ]
    for i in range(1, 13):  # underside, a shallow straight flare
        t = i / 12
        p.append((0.42 + 0.78 * t, 0.05 + 0.22 * t**1.15))
    p.append((ARATI_DISH_R - 0.01, 0.33))  # rim kicks up
    p.append((ARATI_DISH_R, 0.39))
    p.append((ARATI_DISH_R - 0.04, 0.41))
    for i in range(1, 13):  # inside, back down and in to the floor
        t = i / 12
        p.append(
            (ARATI_DISH_R - 0.04 - 0.99 * t, 0.41 - 0.19 * math.sin(t * math.pi * 0.5))
        )

    # --- stem, then the needle spire above the arms ---
    z = 0.22
    collar(p, 0.22, 0.30, z, 0.06)
    z += 0.06
    bulb(p, 0.13, 0.24, z, 0.30)
    z += 0.30
    collar(p, 0.12, 0.19, z, 0.05)
    z += 0.05
    p.append((0.11, z + 0.09))
    z += 0.09
    bulb(p, 0.12, 0.21, z, 0.24)  # the knop the arms spring from
    z += 0.24
    collar(p, 0.10, 0.17, z, 0.05)
    z += 0.05
    bulb(p, 0.07, 0.12, z, 0.18)  # two small knops on the way up the needle
    z += 0.18
    collar(p, 0.06, 0.11, z, 0.05)
    z += 0.05
    for i in range(1, 17):  # needle
        t = i / 16
        p.append((0.075 * (1 - t) ** 1.7, z + 0.83 * t))
    p.append((0.00, z + 0.86))

    parts = [revolve("arati", p, segments=128)]

    # --- arm: a scrolled bracket reaching out, then a riser up to the cup ---
    steps = 26
    arm = bezier(
        (0.11, ARATI_ARM_Z + 0.06),  # leaves the knop heading out and down
        (0.62, ARATI_ARM_Z - 0.30),
        (ARATI_ARM_R + 0.02, ARATI_ARM_Z - 0.10),  # pulls the arrival vertical
        (ARATI_ARM_R, ARATI_CUP_Z),
        steps,
    )
    arm_r = [0.078 - 0.036 * (i / steps) for i in range(steps + 1)]

    # The foliate scroll hanging under each arm. The real ones are pierced
    # sheet; at the size this renders, a tapering spiral carries the same
    # silhouette for a fraction of the geometry.
    volute, volute_r = [], []
    for i in range(13):
        t = i / 12
        a = math.radians(35 + 215 * t)
        rad = 0.22 * (1.0 - 0.42 * t)
        volute.append(
            (0.60 + rad * math.cos(a), ARATI_ARM_Z - 0.20 + rad * math.sin(a))
        )
        volute_r.append(0.054 - 0.032 * t)

    # --- cup: a shallow trumpet on a short foot ---
    cup = [
        (0.00, 0.00),
        (0.055, 0.00),
        (0.065, 0.02),
        (0.05, 0.055),
    ]
    for i in range(1, 11):  # bell flare, convex — not a straight-sided funnel
        t = i / 10
        cup.append(
            (0.05 + 0.185 * math.sin(t * math.pi * 0.5) ** 0.9, 0.055 + 0.15 * t)
        )
    cup.append((0.25, 0.225))
    cup.append((0.245, 0.245))
    for i in range(1, 9):
        t = i / 8
        cup.append((0.245 - 0.21 * t, 0.245 - 0.145 * t**0.75))

    flames = []
    for k in range(ARATI_ARMS):
        theta = math.radians(ARM_PHASE + 360.0 / ARATI_ARMS * k)
        parts.append(sweep(f"arati-arm{k}", arm, arm_r, theta, squash=0.34))
        parts.append(sweep(f"arati-volute{k}", volute, volute_r, theta, squash=0.30))

        x, y = ARATI_ARM_R * math.cos(theta), ARATI_ARM_R * math.sin(theta)
        bowl = revolve(f"arati-cup{k}", cup, segments=64)
        bowl.location = (x, y, ARATI_CUP_Z)
        parts.append(bowl)

        # The wick burns in the cup, just above its rim.
        flames.append((x, y, ARATI_CUP_Z + 0.22))

    return join_all("arati", parts), flames, [("grip", (0.0, 0.0, 0.0))]


# The puja bell, modelled from docs/puja-bell.jpg. Everything is in units of
# the mouth's radius, which is what makes the proportions readable. Measured
# off the reference in those units the four sections come out as skirt 1.20,
# shoulder 0.66, handle 2.07, Nandi 0.95 — so the brass is 3.9 radii tall and
# the whole bell about 4.8, i.e. two and a half times as tall as it is wide.
# Getting the SKIRT height right is what stops it reading as a toadstool: it is
# the section that carries the bell's mass, and a short one puts all the visual
# weight in the handle.
#
# Where a hand closes round the handle, and therefore what the ring rotates
# about: the middle of the shaft. This is the one number the web side needs and
# it is printed as `grip` by every render.
BELL_GRIP_Z = 2.85


def build_bell():
    """The puja bell — turned brass with a Nandi couchant on the handle.

    Rung during arati, so like the arati lamp it is modelled to be picked up:
    no base, no side that is the front. Two constructions, joined — the bell
    and its handle are one lathe-turned profile, and the bull on top is a
    dozen ellipsoids. Nandi is Shiva's mount and faces the deity, which is why
    the bull is broadside to the camera: it is looking at her, not at us.
    """
    # --- mouth, skirt, shoulder ---
    # The mouth is closed with a flat disc. A real bell is open and carries a
    # clapper, but the camera looks 9 degrees DOWN (TILT_DEG) and the mouth
    # faces the floor, so no part of the inside is ever in frame — and when the
    # bell is swung on the page it is a sprite rotating, which cannot open the
    # mouth either.
    p = [
        (0.00, 0.00),
        (0.94, 0.00),
        (1.00, 0.02),  # the lip flares out and slightly over
        (1.00, 0.06),
        (0.96, 0.10),
    ]
    collar(p, 0.95, 0.99, 0.10, 0.055)  # turned band just above the lip
    z = 0.155
    for i in range(1, 15):  # the skirt, drawing in as it rises
        t = i / 14
        p.append((0.95 - 0.23 * t**1.6, z + 1.05 * t))
    z += 1.05

    # The stepped waist. Two rings that stand PROUD of the skirt below them —
    # the reference's most particular feature, and what stops the bell reading
    # as a plain cone with a stick in it.
    collar(p, 0.72, 0.81, z, 0.09)
    z += 0.09
    collar(p, 0.70, 0.77, z, 0.07)
    z += 0.07

    for i in range(1, 15):  # the shoulder, rounding over to the handle
        t = i / 14
        p.append((0.22 + 0.46 * math.cos(t * math.pi * 0.5) ** 0.85, z + 0.49 * t))
    z += 0.49

    # --- handle: three turned sections, each slimmer than the one below ---
    collar(p, 0.20, 0.28, z, 0.07)
    z += 0.07
    bulb(p, 0.145, 0.20, z, 0.28)
    z += 0.28
    for neck, belly, h in (
        (0.125, 0.155, 0.50),
        (0.118, 0.148, 0.50),
        (0.110, 0.140, 0.50),
    ):
        collar(p, neck + 0.01, neck + 0.06, z, 0.055)
        z += 0.055
        bulb(p, neck, belly, z, h)
        z += h

    # The plinth the bull is cast onto.
    collar(p, 0.13, 0.185, z, 0.06)
    z += 0.06
    p.append((0.17, z + 0.03))
    p.append((0.00, z + 0.05))
    base = z  # the Nandi's feet

    parts = [revolve("bell", p, segments=128)]

    # --- Nandi, couchant, in profile ---
    # Broadside to the camera and facing -x, so the silhouette carries it: at
    # the size this renders on the page the bull is about fifteen pixels tall,
    # and a three-quarter view of fifteen pixels is a lump.
    def at(name, scale, loc, rot=(0.0, 0.0, 0.0)):
        parts.append(blob(f"bell-{name}", scale, (loc[0], loc[1], base + loc[2]), rot))

    # Long and low, with one thing standing up out of it. Spheres of similar
    # size clustered together read as a bunch of grapes, so the barrel is
    # stretched well past round, the legs are folded flat under it, and the
    # head is the only mass above the line of the back.
    at("barrel", (0.32, 0.150, 0.135), (0.08, 0.0, 0.165))
    at("rump", (0.19, 0.145, 0.145), (0.31, 0.0, 0.185))
    at("chest", (0.185, 0.150, 0.145), (-0.15, 0.0, 0.200))
    at("hump", (0.150, 0.115, 0.115), (-0.06, 0.0, 0.325))
    # The neck is short and thick and leaves the chest at a steep angle. A
    # long one turns the bull into a camel, which is what the first pass was.
    at(
        "neck",
        (0.115, 0.100, 0.115),
        (-0.30, 0.0, 0.320),
        (0.0, math.radians(-45), 0.0),
    )
    at("head", (0.145, 0.100, 0.115), (-0.44, 0.0, 0.480))
    at("muzzle", (0.095, 0.072, 0.065), (-0.57, 0.0, 0.420))

    for sign in (1, -1):
        y = 0.150 * sign
        at("foreleg", (0.24, 0.050, 0.055), (-0.10, y, 0.045))
        at("knee", (0.075, 0.055, 0.070), (-0.30, y, 0.070))
        at("hindleg", (0.16, 0.065, 0.075), (0.26, y * 0.97, 0.075))
        at(
            "ear",
            (0.045, 0.090, 0.022),
            (-0.40, 0.100 * sign, 0.540),
            (math.radians(-25 * sign), 0.0, 0.0),
        )
        # Up and forward in the xz plane, barely splayed. The camera looks
        # along +y, so a horn splayed sideways is splayed in DEPTH and does not
        # read at all — the pair has to work as one shape seen from the side.
        parts.append(
            spike(
                f"bell-horn{sign}",
                0.042,
                0.15,
                (-0.45, 0.085 * sign, base + 0.535),
                (math.radians(-18 * sign), math.radians(-22), 0.0),
            )
        )

    # The tail, laid down the flank. A free-standing tail is the thinnest thing
    # on the model and would render as a stray whisker.
    parts.append(
        spike(
            "bell-tail",
            0.026,
            0.26,
            (0.40, 0.085, base + 0.22),
            (0.0, math.radians(158), 0.0),
        )
    )

    return join_all("bell", parts), [], [("grip", (0.0, 0.0, BELL_GRIP_Z))]


OBJECTS = {
    "nilavilakku": build_nilavilakku,
    "incense-holder": build_incense,
    "diya": build_diya,
    "kalasha": build_kalasha,
    "arati": build_arati,
    "bell": build_bell,
}


# ---------------------------------------------------------------------------
# Shading, light rig, camera
# ---------------------------------------------------------------------------


def brass_material():
    mat = bpy.data.materials.new("brass")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.86, 0.60, 0.22, 1.0)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.22

    # Hand-polished brass is not uniformly smooth; a fine noise breaks up the
    # specular so it does not read as chrome.
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 22.0
    noise.inputs["Detail"].default_value = 4.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.16, 0.16, 0.16, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.27, 0.27, 0.27, 1)

    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def build_light_rig(height, flames):
    """Shared across every object, so they composite coherently.

    Key comes from the front-right — the centre of the altar (see module
    docstring). Objects with their own flames additionally get a warm point at
    each wick, which is what lights the underside of the rims.
    """
    mid = height * 0.5
    d = max(height, 2.0)

    # Key: warm, from front-right, slightly above centre.
    add_area(
        "key",
        (d * 0.95, -d * 0.75, mid + height * 0.28),
        (math.radians(66), 0, math.radians(52)),
        size=d * 0.9,
        energy=d * d * 11.0,
        color=(1.0, 0.74, 0.46),
    )

    # Fill: dim, front-left, keeps the shadow side from going to pure black.
    add_area(
        "fill",
        (-d * 1.05, -d * 0.85, mid),
        (math.radians(80), 0, math.radians(-50)),
        size=d * 1.2,
        energy=d * d * 2.2,
        color=(1.0, 0.66, 0.42),
    )

    # Rim: from behind and above, separates the silhouette from the backdrop.
    add_area(
        "rim",
        (-d * 0.35, d * 1.0, mid + height * 0.45),
        (math.radians(115), 0, math.radians(-160)),
        size=d * 0.7,
        energy=d * d * 5.5,
        color=(1.0, 0.60, 0.30),
    )

    for i, (x, y, z) in enumerate(flames):
        data = bpy.data.lights.new(f"flame{i}", type="POINT")
        data.energy = height * height * 0.35
        data.color = (1.0, 0.60, 0.24)
        data.shadow_soft_size = 0.06
        obj = bpy.data.objects.new(f"flame{i}", data)
        obj.location = (x, y, z)
        bpy.context.collection.objects.link(obj)


def render_object(name, builder, out_dir):
    clear_scene()
    obj, flames, extra = builder()

    bounds = [obj.matrix_world @ v.co for v in obj.data.vertices]
    z_max = max(v.z for v in bounds)
    r_max = max(math.hypot(v.x, v.y) for v in bounds)
    height = z_max

    obj.data.materials.append(brass_material())
    build_world()
    build_light_rig(height, flames)
    cam = build_camera(height)

    # The tilt swings the base disc into view, so the object needs a little
    # more room vertically and horizontally than its bare radius.
    tilt = math.sin(math.radians(TILT_DEG))
    proj_w = 2.0 * r_max * (1.0 + tilt)
    proj_h = height * math.cos(math.radians(TILT_DEG)) + 2.0 * r_max * tilt

    # Blender fits ortho_scale to whichever resolution axis is larger, so the
    # long side of the object drives both the resolution and the framing.
    # Squat objects (the diya is wider than it is tall) would otherwise be
    # rendered thousands of pixels wide.
    if proj_w >= proj_h:
        width = RENDER_LONG_EDGE_3X
        render_h = max(64, round(RENDER_LONG_EDGE_3X * proj_h / proj_w))
        cam.data.ortho_scale = proj_w * ORTHO_MARGIN
    else:
        render_h = RENDER_LONG_EDGE_3X
        width = max(64, round(RENDER_LONG_EDGE_3X * proj_w / proj_h))
        cam.data.ortho_scale = proj_h * ORTHO_MARGIN

    # Wicks, plus whatever else the object says the web side needs — the grip
    # a hand takes it by, for the two pieces that get picked up. Where that is
    # is the object's business: the arati lamp is held under its dish, at the
    # origin, and the bell most of the way up its handle.
    landmarks = [(f"wick{i}", pt) for i, pt in enumerate(flames)] + extra
    report_projection(
        TAG, name, landmarks, height, width, render_h, cam.data.ortho_scale
    )

    out_path = os.path.join(out_dir, f"{name}@3x.png")
    configure_render(width, render_h, out_path, samples=SAMPLES)
    print(f"[{TAG}] {name}: {width}x{render_h} -> {out_path}")
    bpy.ops.render.render(write_still=True)
    report_content_box(TAG, out_path)
    downscale(out_path, os.path.join(out_dir, f"{name}@2x.png"), 2 / 3)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/images/altar")
    parser.add_argument("--only", action="append", choices=sorted(OBJECTS))
    args = parser.parse_args(argv)

    out_dir = ensure_dir(args.out)

    for name in args.only or sorted(OBJECTS):
        render_object(name, OBJECTS[name], out_dir)


if __name__ == "__main__":
    main()
