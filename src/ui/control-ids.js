let nextDynamicControlId = 1;

function assignDynamicControlIds(root = document) {
  for (const control of root.querySelectorAll('input:not([id]), select:not([id]), textarea:not([id])')) {
    control.id = `fieldweaver-dynamic-control-${nextDynamicControlId}`;
    nextDynamicControlId += 1;
  }
}

assignDynamicControlIds();

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('input:not([id]), select:not([id]), textarea:not([id])')) {
        node.id = `fieldweaver-dynamic-control-${nextDynamicControlId}`;
        nextDynamicControlId += 1;
      }
      assignDynamicControlIds(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
