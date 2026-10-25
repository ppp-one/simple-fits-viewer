# Simple .fits viewer for VSCode

A simple Visual Studio Code extension for viewing FITS (Flexible Image Transport System) files directly within the editor.

🔗 Download here: [simple-fits-viewer](https://marketplace.visualstudio.com/items?itemName=ppp-one.simple-fits-viewer)

<img src="demo.gif" alt="simple-fits-viewer in action" width=100%>

## Features 🎉

- **View FITS Images:** Easily open and view FITS files in Visual Studio Code.
- **Zoom & Pan:** Navigate FITS images with intuitive zoom and pan controls.
- **Header Display:** Access and search headers associated with each FITS file.
- **FWHM/seeing calculation:** Calculate the Full Width at Half Maximum (FWHM) of stars in the image.
- **Interactive Line Profiles:** View and analyze line profiles of FITS images.
- **Archive Images:** For images with a WCS, right-click and choose *Archive images* to overlay an archive image of the same field, resampled onto your pixels. Blend it with the opacity slider or blink between the two. Sources:
  - Dated photographic plates from the [STScI Digitized Sky Survey](https://archive.stsci.edu/cgi-bin/dss_form): POSS-I (1950s) and POSS-II/UKST (1980s-1990s).
  - Harvard [DASCH](https://dasch.cfa.harvard.edu/) plates (1880s-1990s), filtered by limiting magnitude, with buttons to step through them in time.
  - Sky surveys from [CDS HiPS](https://aladin.cds.unistra.fr/hips/) (the surveys Aladin and SIMBAD show): DSS2, 2MASS, SDSS, Pan-STARRS, DESI Legacy Surveys, ZTF, GALEX and AllWISE.

  Archive servers can take 5-20 s to answer. Request times are in the *Simple FITS Viewer* output channel.

## Requirements

- Visual Studio Code

## Extension Settings

None

## Known Issues

See the [issues](http://github.com/ppp-one/simple-fits-viewer/issues) page for known issues.

## Release Notes

See the [CHANGELOG.md](https://github.com/ppp-one/simple-fits-viewer/blob/main/CHANGELOG.md) page for release notes.
