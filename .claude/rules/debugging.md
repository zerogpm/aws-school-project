# Debugging

Data bugs require inspecting the actual datastore FIRST, before reading code.
Query the real table, bucket, or queue and look at what is actually stored.
Reading the code first leads to plausible theories about data that isn't there.

Record errors, surprises, and decisions in `MISTAKES.md` as they happen, not at
the end of the build.
