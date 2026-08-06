#!/usr/bin/env blender --background --python
"""
Renders the individual flowers the garlands are strung from, as PNGs with alpha.

    blender -b -P tools/garland-flowers.py -- --out static/images/garland
    blender -b -P tools/garland-flowers.py -- --only marigold-a

Why single flowers rather than whole garlands. A garland is a closed loop of
flowers on a thread, and its whole physical character is that its shape depends
on how many points you hold it by: one hand and it hangs in a long narrow U,
two corners of a frame and it spreads into a wide shallow drape. That
transition is the act of offering it. A garland rendered as one sprite is rigid
and can only be slid around; a garland assembled at runtime from these sprites
along a simulated thread does the real thing — and ships fewer bytes, because
forty flowers on a strand are a dozen images reused, not one enormous one.

So the split is: Blender owns how a marigold looks, the rope simulation in
src/components/garland-mode.ts owns how a garland hangs.

THREE INVARIANTS the web side depends on, all free by construction here:

  1. Every sprite is rendered at the same resolution, SPRITE_PX square.
  2. Every sprite is framed by the same world-space window, FRAME wide. So the
     flowers' relative sizes are already correct in pixels — a jasmine is
     smaller than a marigold in its PNG because it is smaller in life, and the
     web side draws every sprite at one size without a scale table.
  3. Each flower is modelled centred on the origin and the camera is aimed
     there, so the flower's centre is the centre of its PNG. Threading one onto
     a rope is drawing it centred on a rope point — no offsets to derive.

Break any of the three and the garlands come apart in ways no error reports.

LIGHTING — the brass in altar-assets.py is lit as if the centre of the altar
is to its right, because each piece stands off to one side. A garland hangs on
the frame, across the centre, lit by both nilavilakku at once. So it gets its
own symmetric rig. The world and the camera are the shared ones, which is what
keeps the flowers in the same room as the brass.
"""

import argparse
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blender_common import (  # noqa: E402
    add_area,
    build_camera,
    build_world,
    clear_scene,
    configure_render,
    downscale,
    ensure_dir,
    make_object,
    set_inputs,
)

TAG = "garland-flowers"

# Side of every sprite, in pixels, at 3x. A marigold is drawn 50-70 CSS px on
# a garland, so this is roughly double what the densest display asks for.
SPRITE_PX_3X = 384
SAMPLES = 128

# The world-space window every sprite is framed by — invariant 2. A marigold
# is modelled at radius 1.0, so this leaves it comfortably inside the frame
# with room for the petals that reach past the nominal radius.
FRAME = 2.45


# ---------------------------------------------------------------------------
# Mesh accumulation
#
# Petals are appended into one vertex array rather than built as objects and
# joined. A marigold is a hundred petals; a hundred bpy.ops.object.join calls
# is both slow and a good way to lose the colour attribute.
# ---------------------------------------------------------------------------


class Accum:
    def __init__(self):
        self.verts = []
        self.faces = []
        self.colors = []

    def add(self, verts, faces, color):
        base = len(self.verts)
        self.verts.extend(verts)
        self.faces.extend(tuple(base + i for i in f) for f in faces)
        self.colors.extend([color] * len(verts))

    def bake_facing_camera(self):
        """Rotate +90 deg about X, so the +z the flowers are modelled about
        becomes -y and they face the camera.

        Baked into the vertices rather than left on the object, so the object's
        own rotation is free for the per-variant tilt — which is the whole
        point of having variants. Modelling a flower about its own axis and
        then turning the finished thing to face front is also how you would
        describe it out loud.
        """
        self.verts = [(x, -z, y) for (x, y, z) in self.verts]


def srgb(r, g, b):
    """Colours are easier to reason about as sRGB; Blender wants linear."""

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(r), lin(g), lin(b))


def shade(color, factor):
    return tuple(max(0.0, min(1.0, c * factor)) for c in color)


# ---------------------------------------------------------------------------
# Petals
# ---------------------------------------------------------------------------


def petal_surface(
    length, width, bend, cup, tip_pow=6.0, tip_round=0.5, crease=0.0, nu=8, nv=5
):
    """A petal as a parametric patch, in its own frame.

    +y runs from the attachment point to the tip, +x across, +z out of the
    face. Two curvatures, which between them are most of what tells petals
    apart: `bend` arcs the whole petal along its length (a rose's inner petals
    curl in over the centre, a marigold's outer ones barely move), and `cup`
    troughs it across its width.

    tip_pow / tip_round shape the outline near the tip: high tip_pow keeps the
    petal broad and rounds it off late (marigold), low tip_pow tapers it to a
    point (jasmine, leaves).
    """

    def half_width(u):
        rise = math.sin(min(1.0, u / 0.35) * math.pi / 2) ** 0.7
        taper = max(0.0, 1.0 - u**tip_pow) ** tip_round
        return width * rise * taper

    verts = []
    for i in range(nu + 1):
        u = i / nu
        w = half_width(u)
        for j in range(nv + 1):
            v = -1.0 + 2.0 * j / nv
            z = bend * length * u * u + cup * w * v * v
            z += crease * w * (1.0 - abs(v))
            verts.append((w * v, length * u, z))

    faces = []
    row = nv + 1
    for i in range(nu):
        for j in range(nv):
            a = i * row + j
            faces.append((a, a + 1, a + row + 1, a + row))
    return verts, faces


def rodrigues(vec, axis, angle):
    x, y, z = vec
    ax, ay, az = axis
    c, s = math.cos(angle), math.sin(angle)
    dot = x * ax + y * ay + z * az
    cx = ay * z - az * y
    cy = az * x - ax * z
    cz = ax * y - ay * x
    return (
        x * c + cx * s + ax * dot * (1 - c),
        y * c + cy * s + ay * dot * (1 - c),
        z * c + cz * s + az * dot * (1 - c),
    )


def place(accum, verts, faces, theta, phi, r_base, color, roll=0.0):
    """Attach a petal to the receptacle, pointing outward at (theta, phi).

    theta is measured from the flower's +z axis, so theta=0 is a petal
    standing straight up out of the centre and theta=90 one sticking straight
    out sideways. The petal's face is turned to look up and inward, which is
    the direction a real petal presents to the light.
    """
    st, ct = math.sin(theta), math.cos(theta)
    sp, cp = math.sin(phi), math.cos(phi)

    along = (st * cp, st * sp, ct)
    normal = (-ct * cp, -ct * sp, st)
    if roll:
        normal = rodrigues(normal, along, roll)
    across = (
        normal[1] * along[2] - normal[2] * along[1],
        normal[2] * along[0] - normal[0] * along[2],
        normal[0] * along[1] - normal[1] * along[0],
    )

    ox, oy, oz = (r_base * along[0], r_base * along[1], r_base * along[2])
    placed = [
        (
            ox + vx * across[0] + vy * along[0] + vz * normal[0],
            oy + vx * across[1] + vy * along[1] + vz * normal[1],
            oz + vx * across[2] + vy * along[2] + vz * normal[2],
        )
        for (vx, vy, vz) in verts
    ]
    accum.add(placed, faces, color)


def uv_sphere(radius, squash=1.0, segs=18, rings=11):
    verts, faces = [], []
    for i in range(rings + 1):
        lat = math.pi * i / rings
        for j in range(segs):
            lon = 2.0 * math.pi * j / segs
            verts.append(
                (
                    radius * math.sin(lat) * math.cos(lon),
                    radius * math.sin(lat) * math.sin(lon),
                    radius * math.cos(lat) * squash,
                )
            )
    for i in range(rings):
        for j in range(segs):
            k = (j + 1) % segs
            a, b = i * segs, (i + 1) * segs
            faces.append((a + j, a + k, b + k, b + j))
    return verts, faces


# ---------------------------------------------------------------------------
# The flowers
# ---------------------------------------------------------------------------

CALYX = srgb(0.24, 0.36, 0.13)


def marigold(rand, base, radius=1.0):
    """Chendumalli — the temple flower, and the one a garland is usually all of.

    A dense pompon: rings of short broad petals over a whole sphere, not just
    a disc. The rings past 90 degrees are what give it a back, which matters
    because half the flowers on a hanging garland are seen from below.
    """
    accum = Accum()
    # Short at the pole, growing to full length at the equator. The pole
    # points at the camera, so anything long there is seen end-on and reads as
    # a spike laid across the flower's face rather than as a floret.
    rings = [
        (10, 0.22),
        (24, 0.40),
        (38, 0.62),
        (52, 0.82),
        (66, 0.94),
        (80, 1.00),
        (94, 1.00),
        (108, 0.96),
        (122, 0.88),
        (136, 0.78),
        (150, 0.64),
    ]
    for theta_deg, length_frac in rings:
        theta_base = math.radians(theta_deg)
        count = max(5, round(30 * math.sin(theta_base)))
        for i in range(count):
            phi = 2.0 * math.pi * i / count + rand.uniform(-0.35, 0.35)
            theta = theta_base + math.radians(rand.uniform(-7, 7))
            length = radius * length_frac * rand.uniform(0.80, 1.16)
            verts, faces = petal_surface(
                length,
                # Narrow. A wide petal tiles smoothly against its neighbours
                # and the flower turns into a flat disc; the pompon is made of
                # florets that each stay a separate object at the surface.
                length * 0.19 * rand.uniform(0.85, 1.2),
                bend=0.52 + rand.uniform(-0.1, 0.1),
                # Deeply troughed, so each tip reads as its own little pocket
                # of shadow. This is where the texture comes from.
                cup=1.55,
                tip_pow=6.0,
                tip_round=0.45,
            )
            # Toward the centre the florets are shaded by the ones over them,
            # and marigolds really are redder at the core.
            tone = 0.74 + 0.26 * math.sin(theta_base)
            color = shade(base, tone * rand.uniform(0.9, 1.12))
            place(
                accum,
                verts,
                faces,
                theta,
                phi,
                radius * 0.05,
                color,
                roll=rand.uniform(-0.5, 0.5),
            )

    verts, faces = uv_sphere(radius * 0.34)
    accum.add(verts, faces, shade(base, 0.35))
    return accum


def rose(rand, base, radius=1.0):
    """Petals on a golden-angle spiral, curling in at the centre and reflexing
    at the rim — which is the whole of why a rose reads as a rose."""
    accum = Accum()
    count = 38
    for i in range(count):
        t = i / (count - 1)
        phi = i * math.radians(137.507) + rand.uniform(-0.12, 0.12)
        theta = math.radians(22 + 72 * t**0.7 + rand.uniform(-4, 4))
        # Short and broad at the centre: the furled heart of a rose is a few
        # petal edges seen rolled, not long petals standing on end toward the
        # camera, which is what the pole of this coordinate system points at.
        length = radius * (0.17 + 0.83 * t**0.55) * rand.uniform(0.92, 1.08)
        verts, faces = petal_surface(
            length,
            length * (1.05 - 0.15 * t),
            bend=0.75 - 1.05 * t,
            cup=0.95 - 0.55 * t,
            tip_pow=5.0,
            tip_round=0.4,
        )
        # The floor matters more than the range: crimson at 0.6 under its own
        # shadow is black, and a black rose on a dark altar is a hole.
        color = shade(base, (0.86 + 0.20 * t) * rand.uniform(0.95, 1.06))
        place(
            accum,
            verts,
            faces,
            theta,
            phi,
            radius * 0.05,
            color,
            roll=rand.uniform(-0.2, 0.2),
        )

    verts, faces = uv_sphere(radius * 0.16)
    accum.add(verts, faces, shade(base, 0.75))
    return accum


def jasmine(rand, base, radius=1.0):
    """Mullapoo — a small flat rosette of narrow petals in two whorls."""
    accum = Accum()
    for whorl, (theta_deg, count) in enumerate(((74, 5), (86, 4))):
        for i in range(count):
            phi = 2.0 * math.pi * i / count + whorl * 0.6 + rand.uniform(-0.15, 0.15)
            theta = math.radians(theta_deg + rand.uniform(-6, 6))
            length = radius * 0.92 * rand.uniform(0.9, 1.1)
            verts, faces = petal_surface(
                length,
                length * 0.42,
                bend=-0.14,
                cup=0.28,
                tip_pow=2.2,
                tip_round=0.5,
            )
            color = shade(base, rand.uniform(0.93, 1.03) * (1.0 - 0.06 * whorl))
            place(accum, verts, faces, theta, phi, radius * 0.12, color)

    verts, faces = uv_sphere(radius * 0.17, squash=1.5)
    accum.add(verts, faces, srgb(0.94, 0.86, 0.55))
    return accum


def jasmine_bud(rand, base, radius=1.0):
    """A mullapoo strand is mostly buds, not open flowers — tight furled
    petals on a green calyx."""
    accum = Accum()
    for i in range(5):
        phi = 2.0 * math.pi * i / 5 + rand.uniform(-0.1, 0.1)
        theta = math.radians(9 + rand.uniform(-3, 3))
        length = radius * 0.95 * rand.uniform(0.94, 1.06)
        verts, faces = petal_surface(
            length,
            length * 0.50,
            bend=0.34,
            cup=1.15,
            tip_pow=2.6,
            tip_round=0.45,
        )
        place(
            accum,
            verts,
            faces,
            theta,
            phi,
            radius * 0.06,
            shade(base, rand.uniform(0.9, 1.0)),
            roll=0.5,
        )

    verts, faces = uv_sphere(radius * 0.26, squash=0.7)
    accum.add(verts, faces, CALYX)
    return accum


def leaf(rand, base, radius=1.0):
    """A single blade with a midrib, lying in the plane of the image.

    theta=90, phi=90 puts its length along +y and its face along +z, which
    bake_facing_camera turns into screen-up and toward-camera respectively.
    """
    accum = Accum()
    length = radius * 1.55
    verts, faces = petal_surface(
        length,
        length * 0.26,
        bend=0.10,
        cup=0.18,
        tip_pow=2.0,
        tip_round=0.6,
        crease=-0.30,
        nu=10,
    )
    accum.add(
        [(x, y - length * 0.5, z) for (x, y, z) in verts],
        faces,
        shade(base, rand.uniform(0.9, 1.1)),
    )
    return accum


# ---------------------------------------------------------------------------
# Shading and light
# ---------------------------------------------------------------------------


def petal_material():
    """Diffuse petal plus a translucent term.

    The translucency is what a flower actually is — light comes through a
    petal as much as off it, and the rim light behind these makes the edges
    glow the way they do in front of a lamp. Mixed with a Translucent BSDF
    rather than subsurface scattering because the petals are near enough to
    zero-thickness that random-walk SSS has no volume to work in.

    Base colour comes from the mesh's "col" attribute, so one material covers
    a hundred petals that all differ.
    """
    mat = bpy.data.materials.new("petal")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs["Fac"].default_value = 0.24

    col = nodes.new("ShaderNodeVertexColor")
    col.layer_name = "col"

    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_inputs(
        bsdf,
        {
            "Roughness": 0.46,
            "IOR": 1.4,
            "Sheen Weight": 0.25,
            "Sheen Roughness": 0.3,
            "Specular IOR Level": 0.35,
        },
    )

    # Light that has passed through a petal is deeper and warmer than light
    # bounced off it.
    hsv = nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = 1.35
    hsv.inputs["Value"].default_value = 1.10

    trans = nodes.new("ShaderNodeBsdfTranslucent")

    links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(col.outputs["Color"], hsv.inputs["Color"])
    links.new(hsv.outputs["Color"], trans.inputs["Color"])
    links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    links.new(trans.outputs["BSDF"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])
    return mat


def aim(obj, target=(0.0, 0.0, 0.0)):
    """Point a light's -Z axis at a target.

    Computed rather than hand-tuned, because the rig is symmetric and a pair
    of eyeballed eulers is exactly the kind of thing that ends up not being.
    """
    dx = target[0] - obj.location[0]
    dy = target[1] - obj.location[1]
    dz = target[2] - obj.location[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
    vx, vy, vz = dx / length, dy / length, dz / length
    obj.rotation_euler = (math.acos(max(-1.0, min(1.0, -vz))), 0.0, math.atan2(-vx, vy))


def build_flower_rig(scale):
    """Symmetric, unlike the brass rig — see the module docstring.

    Two warm keys standing in for the nilavilakku flanking the frame, a soft
    top light for the temple's own dimness, and a rim from behind. The rim
    does most of the work here: it is what lights the translucent term, and
    petals lit only from the front look like plastic.
    """
    d = scale
    energy = d * d

    for name, x in (("key-l", -1.0), ("key-r", 1.0)):
        light = add_area(
            name,
            (x * d * 1.05, -d * 0.85, d * 0.45),
            (0, 0, 0),
            size=d * 1.1,
            energy=energy * 13.0,
            color=(1.0, 0.80, 0.58),
        )
        aim(light)

    top = add_area(
        "top",
        (0.0, -d * 0.25, d * 1.7),
        (0, 0, 0),
        size=d * 1.6,
        energy=energy * 6.0,
        color=(1.0, 0.88, 0.74),
    )
    aim(top)

    rim = add_area(
        "rim",
        (0.0, d * 1.3, d * 0.75),
        (0, 0, 0),
        size=d * 1.2,
        energy=energy * 16.0,
        color=(1.0, 0.66, 0.36),
    )
    aim(rim)


# ---------------------------------------------------------------------------
# Sprites
# ---------------------------------------------------------------------------

MARIGOLD_ORANGE = srgb(0.97, 0.42, 0.04)
MARIGOLD_GOLD = srgb(0.99, 0.68, 0.06)
ROSE_CRIMSON = srgb(0.86, 0.09, 0.17)
ROSE_PINK = srgb(0.93, 0.42, 0.53)
JASMINE_WHITE = srgb(0.98, 0.96, 0.91)
LEAF_GREEN = srgb(0.32, 0.56, 0.19)

# (builder, colour, radius, tilt about x, tilt about z, seed)
#
# The tilts are the point of having variants at all, and they are large on
# purpose. A flower on a garland is threaded through, so it presents its side
# or three-quarter face far more often than its front — and a flower rendered
# pole-on has a second problem, that petals near the pole are surfaces seen
# edge-on, which draw as spokes across the middle rather than as petals.
# Turning each variant well off frontal fixes the look and the artefact at
# once. Rotation *within* the image plane is free at runtime, so no variant
# spends itself on it.
SPRITES = {
    "marigold-a": (marigold, MARIGOLD_ORANGE, 1.00, -38, 10, 11),
    "marigold-b": (marigold, MARIGOLD_ORANGE, 0.94, 46, -22, 23),
    "marigold-c": (marigold, MARIGOLD_GOLD, 0.97, -16, 34, 37),
    "marigold-d": (marigold, MARIGOLD_GOLD, 0.90, 60, 12, 41),
    "rose-a": (rose, ROSE_CRIMSON, 0.92, -44, 16, 53),
    "rose-b": (rose, ROSE_CRIMSON, 0.86, 36, -28, 67),
    "rose-c": (rose, ROSE_PINK, 0.89, -20, 40, 71),
    "jasmine-a": (jasmine, JASMINE_WHITE, 0.42, -24, 12, 83),
    "jasmine-b": (jasmine, JASMINE_WHITE, 0.38, 30, -18, 97),
    "jasmine-bud-a": (jasmine_bud, JASMINE_WHITE, 0.34, -52, 24, 101),
    "jasmine-bud-b": (jasmine_bud, JASMINE_WHITE, 0.31, 64, -10, 103),
    "leaf-a": (leaf, LEAF_GREEN, 0.72, -6, 14, 107),
    "leaf-b": (leaf, LEAF_GREEN, 0.66, 10, -20, 109),
}


def render_sprite(name, out_dir):
    builder, base, radius, tilt_x, tilt_z, seed = SPRITES[name]

    clear_scene()
    accum = builder(random.Random(seed), base, radius)
    accum.bake_facing_camera()
    # A deep cup folds a petal past the default 35 deg crease angle, which
    # would shade the fold as a hard edge and make the flower faceted.
    obj = make_object(
        name, accum.verts, accum.faces, smooth_angle=62.0, colors=accum.colors
    )

    # Petals are modelled as surfaces; a little thickness gives them an edge
    # to catch the key light on, which is most of what stops them reading as
    # paper cut-outs.
    solidify = obj.modifiers.new("thickness", "SOLIDIFY")
    solidify.thickness = radius * 0.012
    solidify.offset = 0.0

    obj.rotation_euler = (math.radians(tilt_x), 0.0, math.radians(tilt_z))
    obj.data.materials.append(petal_material())

    build_world()
    build_flower_rig(FRAME * 0.5)
    cam = build_camera(FRAME, target_z=0.0)
    # Invariants 2 and 3: one shared window for every sprite, centred on the
    # origin the flower was modelled about.
    cam.data.ortho_scale = FRAME

    out_path = os.path.join(out_dir, f"{name}@3x.png")
    configure_render(
        SPRITE_PX_3X,
        SPRITE_PX_3X,
        out_path,
        samples=SAMPLES,
        exposure=0.85,
        look="AgX - Punchy",
    )
    print(f"[{TAG}] {name}: {SPRITE_PX_3X}px, {len(accum.faces)} faces -> {out_path}")
    bpy.ops.render.render(write_still=True)
    downscale(out_path, os.path.join(out_dir, f"{name}@2x.png"), 2 / 3)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="static/images/garland")
    parser.add_argument("--only", action="append", choices=sorted(SPRITES))
    args = parser.parse_args(argv)

    out_dir = ensure_dir(args.out)
    for name in args.only or sorted(SPRITES):
        render_sprite(name, out_dir)


if __name__ == "__main__":
    main()
