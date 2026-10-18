def tracked(fn):
    return fn


class Base:
    @tracked
    def save(self):
        return None

    def validate(self):
        return True
