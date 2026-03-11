function favicons() {
  this.hidden = "hidden";
  this.visibilityChange = "visibilitychange";
  this.title = document.title;
  this.wasSpoofed = false;
  this.spoofed = [];
  this.files = ["/data/iast.txt", "/data/devanagari.txt", "/data/malayalam.txt"];
  this.lines = {};

  this.init = async function () {
    if (typeof document.mozHidden !== "undefined") {
      this.hidden = "mozHidden";
      this.visibilityChange = "mozvisibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
      this.hidden = "msHidden";
      this.visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
      this.hidden = "webkitHidden";
      this.visibilityChange = "webkitvisibilitychange";
    }
    for (const file of this.files) {
      try {
        const response = await fetch(file);
        const text = await response.text();
        this.lines[file] = text.split("\n").filter(line => line.trim().length > 0);
      } catch (e) {
        console.error("Failed to load", file, e);
      }
    }
    document.addEventListener(
      this.visibilityChange,
      this.handler.bind(this),
      false,
    );
  };

  this.default = function () {
    document.title = this.title;
    if (this.wasSpoofed === true) {
      document.getElementById("disablejs").style.display = "block";
      document.getElementById("disablejs").innerHTML = `
        <p>
          <strong>(CLICK/TAP THIS OVERLAY ANYWHERE TO CLOSE IT)</strong>
        </p>
        <p>
          <a href="https://disable-javascript.org" target="_self" title="disable-javascript.org">More information here.</a>
        </p>
        <p>
          <strong>(CLICK/TAP THIS OVERLAY ANYWHERE TO CLOSE IT)</strong>
        </p>
        `;
    }
  };

  this.update = function (title) {
    document.title = title;
    if (this.wasSpoofed === true) {
      document.getElementById("disablejs").style.display = "block";
      document.getElementById("disablejs").innerHTML = `
        <p>
          <strong>(CLICK/TAP THIS OVERLAY ANYWHERE TO CLOSE IT)</strong>
        </p>
        <p>
          <a href="https://disable-javascript.org" target="_self" title="disable-javascript.org">More information here.</a>
        </p>
        <p>
          <strong>(CLICK/TAP THIS OVERLAY ANYWHERE TO CLOSE IT)</strong>
        </p>
        `;
    }
  };

  this.spoof = function () {
    const availableFiles = this.files.filter(f => this.lines[f] && this.lines[f].length > 0);
    if (availableFiles.length === 0) return;
    
    const randomFile = availableFiles[Math.floor(Math.random() * availableFiles.length)];
    const randomLine = this.lines[randomFile][Math.floor(Math.random() * this.lines[randomFile].length)];
    
    this.update(randomLine);
    this.wasSpoofed = true;
  };

  this.handler = function () {
    if (document[this.hidden]) {
      this.spoof();
    } else {
      this.default();
    }
  };

  this.init();
}

function closeDisablejsInfo() {
  document.getElementById("disablejs").style.display = "none";
}

var f = new favicons();
