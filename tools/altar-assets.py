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
import subprocess
import sys

import bpy

# Height of the longest edge of each render, in pixels, at 3x.
RENDER_LONG_EDGE_3X = 1536
SAMPLES = 160

# Degrees the camera looks down. Enough to open up bowls and rims, little
# enough that the object still sits flat against a 2D page layout.
TILT_DEG = 9.0
ORTHO_MARGIN = 1.10

# Angle of the first wick-bearing arm, measured from +x. 90 deg points straight
# away from the camera, and five-fold symmetry has a mirror plane through each
# arm, so this is the one orientation that reads symmetrically head-on: one
# wick at the back, two at the sides, two at the front. Shared by the
# nilavilakku's lotus lips and the arati lamp's arms so they look like a set.
ARM_PHASE = 90.0


# ---------------------------------------------------------------------------
# Lathe
# ---------------------------------------------------------------------------


def make_object(name, verts, faces, smooth_angle=35.0):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth_angle))
    obj.select_set(False)
    return obj


def join_all(name, objs):
    """Merge parts into one object.

    Only for pieces that are not a single surface of revolution — the arati
    lamp's arms are brazed onto a turned body, so the model is assembled the
    way the object is. Everything downstream (bounds, material, framing)
    assumes one mesh per asset.
    """
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()

    joined = bpy.context.view_layer.objects.active
    joined.name = name
    # Join keeps only the active object's modifiers, so the auto-smooth the
    # parts each carried is gone for all but one. Re-apply across the whole.
    bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    joined.select_set(False)
    return joined


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
    return obj, flames


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
    return obj, []


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
    return obj, [(0.0, 0.0, 0.30)]


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
    return obj, []


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

    return join_all("arati", parts), flames


OBJECTS = {
    "nilavilakku": build_nilavilakku,
    "incense-holder": build_incense,
    "diya": build_diya,
    "kalasha": build_kalasha,
    "arati": build_arati,
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


def build_world():
    """A dark warm gradient. Metal is pure reflection — with a black world the
    brass would render black. This is the shrine interior it reflects."""
    world = bpy.data.worlds.new("shrine")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputWorld")
    bg = nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0

    tex = nodes.new("ShaderNodeTexGradient")
    tex.gradient_type = "EASING"
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0.0, math.radians(-90), 0.0)
    coord = nodes.new("ShaderNodeTexCoord")

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.055, 0.026, 0.016, 1)  # floor
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.240, 0.130, 0.060, 1)  # warm above

    links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bg.inputs["Color"])
    links.new(bg.outputs["Background"], out.inputs["Surface"])


def add_area(name, location, rotation, size, energy, color):
    data = bpy.data.lights.new(name, type="AREA")
    data.size = size
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.collection.objects.link(obj)
    return obj


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


def build_camera(height):
    """Orthographic, tilted slightly down.

    Orthographic because the altar is a flat CSS composition and perspective
    convergence here would fight the page layout. Tilted because a dead-level
    view puts the oil dish exactly edge-on, where it reads as a flat saucer
    instead of a bowl with lips.
    """
    data = bpy.data.cameras.new("camera")
    data.type = "ORTHO"
    data.ortho_scale = height * ORTHO_MARGIN

    pitch = math.radians(90.0 - TILT_DEG)
    # A camera with no rotation looks along -Z; R_x(pitch) sends that to
    # (0, sin(pitch), -cos(pitch)).
    forward = (0.0, math.sin(pitch), -math.cos(pitch))
    dist = height * 4.0
    target_z = height * 0.5

    cam = bpy.data.objects.new("camera", data)
    cam.location = (
        -dist * forward[0],
        -dist * forward[1],
        target_z - dist * forward[2],
    )
    cam.rotation_euler = (pitch, 0.0, 0.0)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def configure_render(width, height, out_path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.transmission_bounces = 4

    scene.render.film_transparent = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.compression = 90
    scene.render.filepath = out_path

    # AgX alone desaturates gold badly; Punchy plus a little exposure keeps the
    # brass reading as warm metal rather than brown.
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    scene.view_settings.exposure = 0.5


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def report_projection(name, points, height, width, render_h, ortho_scale):
    """Print where world points land in the render, as fractions of the PNG.

    This is the number the web side needs and cannot compute: WICKS in
    altar.ts, the diya's flame offset, the arati lamp's grip point. They used
    to be re-derived by hand from this script's camera, which is exactly the
    kind of coupling that goes stale silently. Re-render and the correct
    values are in the log.

    The camera is orthographic with screen right = +x and screen up
    (0, sin TILT, cos TILT), aimed at (0, 0, height/2). Blender fits
    ortho_scale to the longer resolution axis.
    """
    if width >= render_h:
        ortho_w = ortho_scale
        ortho_h = ortho_scale * render_h / width
    else:
        ortho_h = ortho_scale
        ortho_w = ortho_scale * width / render_h

    tilt = math.radians(TILT_DEG)
    print(f"[altar-assets] {name}: projected fractions of the {width}x{render_h} PNG")
    for label, (x, y, z) in points:
        fx = 0.5 + x / ortho_w
        fy = 0.5 - (y * math.sin(tilt) + (z - height * 0.5) * math.cos(tilt)) / ortho_h
        print(f"[altar-assets]   {label:<14} x: {fx:.4f}  y: {fy:.4f}")


def render_object(name, builder, out_dir):
    clear_scene()
    obj, flames = builder()

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

    # The grip: the centre of the dish's underside, which is where a hand
    # holds a lamp and therefore what the arati wave has to rotate about.
    landmarks = [(f"wick{i}", pt) for i, pt in enumerate(flames)]
    landmarks.append(("grip", (0.0, 0.0, 0.0)))
    report_projection(name, landmarks, height, width, render_h, cam.data.ortho_scale)

    out_path = os.path.join(out_dir, f"{name}@3x.png")
    configure_render(width, render_h, out_path)
    print(f"[altar-assets] {name}: {width}x{render_h} -> {out_path}")
    bpy.ops.render.render(write_still=True)
    report_content_box(out_path)
    downscale(out_path, os.path.join(out_dir, f"{name}@2x.png"), 2 / 3)


def report_content_box(src):
    """Print how much of the PNG is transparent margin, as fractions.

    ORTHO_MARGIN leaves clear space around every render, so an element sized
    to the PNG floats above whatever it is meant to stand on. The web side
    needs to know by how much — the arati lamp's `bottom` offset on its shelf
    is exactly this number — and it cannot be derived from the camera, because
    it depends on where the silhouette actually falls.
    """
    try:
        out = subprocess.run(
            ["magick", src, "-format", "%w %h %@", "info:"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as err:
        print(f"[altar-assets] WARNING: could not measure {src}: {err}")
        return

    # "%@" is WxH+X+Y of the opaque bounding box.
    w, h, box = out.split(" ", 2)
    size, _, offset = box.partition("+")
    bw, bh = (int(v) for v in size.split("x"))
    bx, by = (int(v) for v in offset.split("+"))
    w, h = int(w), int(h)

    print(
        f"[altar-assets]   content box    "
        f"left: {bx / w:.4f}  right: {1 - (bx + bw) / w:.4f}  "
        f"top: {by / h:.4f}  bottom: {1 - (by + bh) / h:.4f}"
    )


def downscale(src, dst, factor):
    """Derive the 2x asset from the 3x render rather than rendering twice, so
    the two are guaranteed identical apart from resolution."""
    try:
        subprocess.run(
            ["magick", src, "-resize", f"{factor * 100:.4f}%", dst],
            check=True,
            capture_output=True,
        )
        print(f"[altar-assets] downscaled -> {dst}")
    except (OSError, subprocess.CalledProcessError) as err:
        print(f"[altar-assets] WARNING: could not downscale {src}: {err}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/images/altar")
    parser.add_argument("--only", action="append", choices=sorted(OBJECTS))
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    for name in args.only or sorted(OBJECTS):
        render_object(name, OBJECTS[name], out_dir)


if __name__ == "__main__":
    main()
