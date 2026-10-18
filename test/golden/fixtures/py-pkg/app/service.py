import app.models
from . import base
from app import User
from app.util import helper as h


class Service(base.Base):
    def run(self):
        u = User()
        h()
        app.models.Admin()
        return u

    def save(self):
        return super().save()
