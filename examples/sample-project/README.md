# Local mock demo

In this directory, run `git init -b main`, `git add .`, and `git commit -m "Demo baseline"`.
Open this directory in the extension development host. Add the following **dummy** assignment
to `payments.py` and save:

```python
password = "demo-only-not-a-real-secret"
```

Run **VeriReview: Review My Changes**. The mock provider should flag line 6 (or wherever
you added it), with an explicit mock label and demo-pattern evidence. Select the sidebar
finding to navigate and view details. Remove the assignment and rerun: it disappears.

This demonstrates transport and editor integration, not semantic AI capability.
