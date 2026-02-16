
  /* Wait for the new SW to activate. Since we've removed the timeout,
     this will wait indefinitely (or until the browser times out) for
     the service worker to finish installing and activating. The spinner
     will remain visible until activation is complete. */
  await new Promise((resolve) => {
    if (pending.state === "activated") { resolve(); return; }
    const onStateChange = () => {
      if (pending.state === "activated" || pending.state === "redundant") {
        pending.removeEventListener("statechange", onStateChange);
        resolve();
      }
    };
    pending.addEventListener("statechange", onStateChange);
  });

  spinner.remove();

  // Update is either applied or in-flight — reload either way.
  // The sessionStorage flag prevents an infinite loop on the next load.
  sessionStorage.setItem(UPDATE_CHECK_KEY, "1");
  window.location.reload();
}
