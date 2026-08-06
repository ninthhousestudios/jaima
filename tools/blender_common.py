"""Shared Blender scaffolding for the room's rendered assets.

Imported (hence the underscore) by `altar-assets.py` and `garland-flowers.py`.
Everything here is the part of the pipeline the two have to agree on: the
camera, the world, the output settings, and the mesh plumbing. What differs —
lathe geometry and the brass light rig, versus petals and a symmetric one —
stays in the callers.

The camera convention is the reason this is shared rather than copied. Every
asset in the room is rendered orthographically under the same TILT_DEG, so
they composite as one altar seen from one place. A garland rendered at a
different tilt would read as a sticker laid over the shrine no matter how well
it was shaded.
"""

import math
import os
import subprocess

import bpy

# Degrees the camera looks down. Enough to open up bowls and rims, little
# enough that the object still sits flat against a 2D page layout.
TILT_DEG = 9.0

# Clear space left around every render, as a multiple of the object's extent.
ORTHO_MARGIN = 1.10


# ---------------------------------------------------------------------------
# Meshes
# ---------------------------------------------------------------------------


def make_object(name, verts, faces, smooth_angle=35.0, colors=None):
    """Build a mesh object.

    colors: optional per-vertex (r, g, b), stored as a POINT-domain colour
            attribute named "col". It is how a flower gets petal-to-petal
            variation out of a single material: the alternative, one material
            per petal, would put forty materials on one mesh, and Cycles'
            per-object Random node cannot help because the petals are joined
            into a single object before rendering.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()

    if colors is not None:
        attr = mesh.color_attributes.new(name="col", type="FLOAT_COLOR", domain="POINT")
        for i, (r, g, b) in enumerate(colors):
            attr.data[i].color = (r, g, b, 1.0)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(smooth_angle))
    obj.select_set(False)
    return obj


def join_all(name, objs):
    """Merge parts into one object.

    Everything downstream (bounds, material, framing) assumes one mesh per
    asset, so anything built from several pieces — the arati lamp's brazed-on
    arms, a flower's petals — is joined before it is rendered.
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


def set_inputs(node, values):
    """Set shader inputs by name, skipping any this Blender does not have.

    The Principled BSDF's socket names have moved more than once ("Subsurface"
    became "Subsurface Weight" in 4.0). Rendering with a slightly plainer
    shader is a far better failure than the whole script dying on a KeyError.
    """
    for key, value in values.items():
        if key in node.inputs:
            node.inputs[key].default_value = value


# ---------------------------------------------------------------------------
# World, camera, output
# ---------------------------------------------------------------------------


def build_world():
    """A dark warm gradient — the shrine interior every asset sits in.

    Metal is pure reflection, so with a black world the brass would render
    black. Petals take much less from it, but they take their ambient tint
    from here, which is what keeps flowers and brass in one colour family.
    """
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


def build_camera(height, target_z=None):
    """Orthographic, tilted slightly down.

    Orthographic because the altar is a flat CSS composition and perspective
    convergence here would fight the page layout. Tilted because a dead-level
    view puts the oil dish exactly edge-on, where it reads as a flat saucer
    instead of a bowl with lips.

    target_z defaults to height/2 — right for an object standing on the floor
    at z=0. Anything modelled centred on the origin passes 0.
    """
    data = bpy.data.cameras.new("camera")
    data.type = "ORTHO"
    data.ortho_scale = height * ORTHO_MARGIN

    pitch = math.radians(90.0 - TILT_DEG)
    # A camera with no rotation looks along -Z; R_x(pitch) sends that to
    # (0, sin(pitch), -cos(pitch)).
    forward = (0.0, math.sin(pitch), -math.cos(pitch))
    dist = max(height, 1.0) * 4.0
    if target_z is None:
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


def configure_render(
    width, height, out_path, samples=160, exposure=0.5, look="AgX - Punchy"
):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
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

    # AgX alone desaturates warm colour badly; Punchy plus a little exposure
    # keeps the brass reading as metal rather than brown, and the marigolds
    # orange rather than tan.
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = look
    scene.view_settings.exposure = exposure


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# Reporting back to the web side
# ---------------------------------------------------------------------------


def project(point, height, width, render_h, ortho_scale, target_z=None):
    """Where a world point lands in the render, as fractions of the PNG.

    The camera is orthographic with screen right = +x and screen up
    (0, sin TILT, cos TILT), aimed at (0, 0, target_z). Blender fits
    ortho_scale to the longer resolution axis.
    """
    if width >= render_h:
        ortho_w = ortho_scale
        ortho_h = ortho_scale * render_h / width
    else:
        ortho_h = ortho_scale
        ortho_w = ortho_scale * width / render_h

    if target_z is None:
        target_z = height * 0.5

    tilt = math.radians(TILT_DEG)
    x, y, z = point
    fx = 0.5 + x / ortho_w
    fy = 0.5 - (y * math.sin(tilt) + (z - target_z) * math.cos(tilt)) / ortho_h
    return fx, fy


def report_projection(
    tag, name, points, height, width, render_h, ortho_scale, target_z=None
):
    """Print projected landmarks.

    This is the number the web side needs and cannot compute: WICKS in
    altar.ts, the diya's flame offset, the arati lamp's grip point. They used
    to be re-derived by hand from this script's camera, which is exactly the
    kind of coupling that goes stale silently. Re-render and the correct
    values are in the log.
    """
    print(f"[{tag}] {name}: projected fractions of the {width}x{render_h} PNG")
    for label, pt in points:
        fx, fy = project(pt, height, width, render_h, ortho_scale, target_z)
        print(f"[{tag}]   {label:<14} x: {fx:.4f}  y: {fy:.4f}")


def content_box(src):
    """The opaque bounding box of a PNG, as (left, right, top, bottom)
    fractions of transparent margin. None if it could not be measured.

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
        print(f"WARNING: could not measure {src}: {err}")
        return None

    # "%@" is WxH+X+Y of the opaque bounding box.
    w, h, box = out.split(" ", 2)
    size, _, offset = box.partition("+")
    bw, bh = (int(v) for v in size.split("x"))
    bx, by = (int(v) for v in offset.split("+"))
    w, h = int(w), int(h)
    return bx / w, 1 - (bx + bw) / w, by / h, 1 - (by + bh) / h


def report_content_box(tag, src):
    box = content_box(src)
    if box is None:
        return
    left, right, top, bottom = box
    print(
        f"[{tag}]   content box    "
        f"left: {left:.4f}  right: {right:.4f}  "
        f"top: {top:.4f}  bottom: {bottom:.4f}"
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
        print(f"downscaled -> {dst}")
    except (OSError, subprocess.CalledProcessError) as err:
        print(f"WARNING: could not downscale {src}: {err}")


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)
    return os.path.abspath(path)
