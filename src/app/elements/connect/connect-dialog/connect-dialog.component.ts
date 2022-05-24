import {Component, OnInit, Inject, ViewChild, ChangeDetectorRef} from '@angular/core';
import 'rxjs/add/operator/toPromise';
import {AppService, LogService, SettingService, HttpService, LocalStorageService} from '@app/services';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material';
import {ConnectType, ConnectData, TreeNode, SystemUser, AuthInfo, ConnectOption} from '@app/model';
import {ElementManualAuthComponent} from './manual-auth/manual-auth.component';
import {BehaviorSubject} from 'rxjs';

@Component({
  selector: 'elements-asset-tree-dialog',
  templateUrl: 'connect-dialog.component.html',
  styleUrls: ['./connect-dialog.component.scss'],
})
export class ElementConnectDialogComponent implements OnInit {
  @ViewChild('manualAuth', {static: false}) manualAuthRef: ElementManualAuthComponent;
  public onSubmit$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(true);
  public node: TreeNode;
  public outputData: ConnectData = new ConnectData();
  public systemUsers: SystemUser[];
  public manualAuthInfo: AuthInfo = new AuthInfo();
  public systemUserSelected: SystemUser = null;
  public connectType: ConnectType;
  public connectTypes = [];
  public autoLogin = false;
  public connectOptions: ConnectOption[] = [];

  public loading = true;
  public userId = null;
  public userName = null;

  constructor(public dialogRef: MatDialogRef<ElementConnectDialogComponent>,
              private _settingSvc: SettingService,
              private _cdRef: ChangeDetectorRef,
              private _logger: LogService,
              private _appSvc: AppService,
              private _http: HttpService,
              private _localStorage: LocalStorageService,
              @Inject(MAT_DIALOG_DATA) public data: any,
  ) {}

  ngOnInit() {
    this.systemUsers = this.data.systemUsers;
    this.node = this.data.node;
    this.loading = false;
    this.userId = this._localStorage.get('user');
    this.userName = this._localStorage.get('username');
  }

  onSelectSystemUser(systemUser) {
    this.systemUserSelected = systemUser;

    if (!systemUser) {
      return;
    }
    this.setConnectTypes();
    // this._cdRef.detectChanges();
    setTimeout(() => {
      if (this.manualAuthRef) {
        this.manualAuthRef.onSystemUserChanged();
      }
    });
  }

  setConnectTypes() {
    const isRemoteApp = this.node.meta.type === 'application';
    this.connectTypes = this._appSvc.getProtocolConnectTypes(isRemoteApp)[this.systemUserSelected.protocol];
    this.connectType = this.getPreferConnectType() || this.connectTypes[0];
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  hasRDPClientTypes() {
    return this.connectType && this.connectType.id === 'rdpClient';
  }

  getPreferConnectType() {
    const preferConnectTypeId = this._appSvc.getProtocolPreferLoginType(this.systemUserSelected.protocol);
    const matchedTypes = this.connectTypes.filter((item) => item.id === preferConnectTypeId);
    if (matchedTypes.length === 1) {
      return matchedTypes[0];
    } else {
      return this.connectTypes[0];
    }
  }

  onCheck() {
    this.outputData.connectType = this.connectType;
    this.outputData.manualAuthInfo = this.manualAuthInfo;
    this.outputData.connectOptions = this.connectOptions;
    this.outputData.systemUser = this.systemUserSelected;
    if (this.autoLogin) {
      this._appSvc.setPreLoginSelect(this.node, this.outputData);
    }
    if (this.outputData.systemUser.name === 'sudo' || this.outputData.systemUser.name  === 'no_sudo' ) {
      this.loading = true;
      this._http.getLoginLogs(this.userId, this.node.id, this.outputData.systemUser.id).subscribe(
        data => {
          if (data) {
            if (data.is_first_login) {
              this.pushSystemUser();
            } else {
              if (data.has_changed_permission) {
                this.pushSystemUser();
              } else {
                this.onConfirm();
              }
            }
          } else {
            const params = {
              asset_id : this.node.meta.data.id,
              asset_hostname: this.node.meta.data.hostname,
              asset_ip: this.node.meta.data.ip,
              user_id: this.userId,
              username: this.userName,
              system_user_id: this.outputData.systemUser.id
            };
            this._http.postLoginLogs(params).subscribe( resp => {
              this.pushSystemUser();
            });
          }
        },
        err => {
          alert('推送失败');
          this.loading = false;
        });
    } else {
      this.onConfirm();
    }
  }
  onConfirm() {
    this.onSubmit$.next(true);
    const nodeID = this._appSvc.getNodeTypeID(this.node);
    this._appSvc.setNodePreferSystemUser(nodeID, this.systemUserSelected.id);
    this._appSvc.setProtocolPreferLoginType(this.systemUserSelected.protocol, this.connectType.id);
    this.dialogRef.close(this.outputData);
  }

  onAdvancedOptionChanged(evt) {
    this.connectOptions = evt;
  }

  pushSystemUser() {
    const params = {
      action : 'push',
      asset: this.node.meta.data.id,
      system_user: this.systemUserSelected.id
    };
    this._http.postSystemUserTask(this.userName, params).subscribe( () => {
      let count = 0;
      const interval = setInterval(() => {
        this._http.getLoginLogs(this.userId, this.node.id, this.outputData.systemUser.id).subscribe(
          data => {
          if (count ++ >= 20) {
            clearInterval(interval);
            alert('推送失败');
            this.loading = false;
          }
          if (data.has_pushed && !data.has_changed_permission) {
            clearInterval(interval);
            this.onConfirm();
          }
        });
      }, 3000);
    },
    err => {
      alert('推送失败');
      this.loading = false;
    });
  }
}
